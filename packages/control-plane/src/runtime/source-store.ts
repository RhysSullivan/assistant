import type {
  AccountId,
  Credential,
  CredentialSlot,
  SecretRef,
  Source,
  SourceRecipeId,
  SourceRecipeRevisionId,
  WorkspaceId,
} from "#schema";
import { type SqlControlPlaneRows } from "#persistence";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  createSourceRecipeRecord,
  createSourceRecipeRevisionRecord,
  projectSourceFromStorage,
  projectSourcesFromStorage,
  stableSourceRecipeId,
  stableSourceRecipeRevisionId,
  splitSourceForStorage,
} from "./source-definitions";
import { createDefaultSecretMaterialDeleter } from "./secret-material-providers";

const credentialSecretRefs = (credential: Credential): ReadonlyArray<SecretRef> => [
  {
    providerId: credential.tokenProviderId,
    handle: credential.tokenHandle,
  },
  ...(credential.refreshTokenProviderId !== null && credential.refreshTokenHandle !== null
    ? [{
        providerId: credential.refreshTokenProviderId,
        handle: credential.refreshTokenHandle,
      } satisfies SecretRef]
    : []),
];

const secretRefKey = (ref: SecretRef): string => `${ref.providerId}:${ref.handle}`;

const cleanupCredentialSecretRefs = (rows: SqlControlPlaneRows, input: {
  previous: Credential | null;
  next: Credential | null;
}) =>
  Effect.gen(function* () {
    if (input.previous === null) {
      return;
    }

    const deleteSecretMaterial = createDefaultSecretMaterialDeleter({ rows });
    const nextRefKeys = new Set(
      (input.next === null ? [] : credentialSecretRefs(input.next)).map(secretRefKey),
    );
    const refsToDelete = credentialSecretRefs(input.previous).filter(
      (ref) => !nextRefKeys.has(secretRefKey(ref)),
    );

    yield* Effect.forEach(
      refsToDelete,
      (ref) => Effect.either(deleteSecretMaterial(ref)),
      { discard: true },
    );
  });

const selectPreferredCredential = (input: {
  credentials: ReadonlyArray<Credential>;
  actorAccountId?: AccountId | null;
  slot: CredentialSlot;
}): Credential | null => {
  const matchingSlot = input.credentials.filter((credential) => credential.slot === input.slot);

  if (input.actorAccountId !== undefined) {
    const exact = matchingSlot.find((credential) => credential.actorAccountId === input.actorAccountId);
    if (exact) {
      return exact;
    }
  }

  return matchingSlot.find((credential) => credential.actorAccountId === null) ?? null;
};

const selectExactCredential = (input: {
  credentials: ReadonlyArray<Credential>;
  actorAccountId?: AccountId | null;
  slot: CredentialSlot;
}): Credential | null =>
  input.credentials.find(
    (credential) =>
      credential.slot === input.slot
      && credential.actorAccountId === (input.actorAccountId ?? null),
  ) ?? null;

export const loadSourcesInWorkspace = (
  rows: SqlControlPlaneRows,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
) =>
  Effect.gen(function* () {
    const sourceRecords = yield* rows.sources.listByWorkspaceId(workspaceId);
    const credentials = yield* rows.credentials.listByWorkspaceId(workspaceId);
    const filteredCredentials = sourceRecords.flatMap((sourceRecord) => {
      const matches = credentials.filter((credential) => credential.sourceId === sourceRecord.id);
      const preferred = selectPreferredCredential({
        credentials: matches,
        actorAccountId: options.actorAccountId,
        slot: "runtime",
      });
      const preferredImport = selectPreferredCredential({
        credentials: matches,
        actorAccountId: options.actorAccountId,
        slot: "import",
      });
      return [preferred, preferredImport].filter(
        (credential): credential is Credential => credential !== null,
      );
    });

    return yield* projectSourcesFromStorage({
      sourceRecords,
      credentials: filteredCredentials,
    });
  });

export const loadSourceById = (rows: SqlControlPlaneRows, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  actorAccountId?: AccountId | null;
}) =>
  Effect.gen(function* () {
    const sourceRecord = yield* rows.sources.getByWorkspaceAndId(
      input.workspaceId,
      input.sourceId,
    );

    if (Option.isNone(sourceRecord)) {
      return yield* Effect.fail(
        new Error(`Source not found: workspaceId=${input.workspaceId} sourceId=${input.sourceId}`),
      );
    }

    const credentials = yield* rows.credentials.listByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });
    const credential = selectPreferredCredential({
      credentials,
      actorAccountId: input.actorAccountId,
      slot: "runtime",
    });
    const importCredential = selectPreferredCredential({
      credentials,
      actorAccountId: input.actorAccountId,
      slot: "import",
    });

    return yield* projectSourceFromStorage({
      sourceRecord: sourceRecord.value,
      runtimeCredential: credential,
      importCredential,
    });
  });

const removeCredentialsForSource = (rows: SqlControlPlaneRows, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}) =>
  Effect.gen(function* () {
    const existingCredentials = yield* rows.credentials.listByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    yield* rows.credentials.removeByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    yield* Effect.forEach(
      existingCredentials,
      (credential) =>
        cleanupCredentialSecretRefs(rows, {
          previous: credential,
          next: null,
        }),
      { discard: true },
    );

    return existingCredentials.length;
  });

const cleanupOrphanedRecipeData = (rows: SqlControlPlaneRows, input: {
  recipeId: SourceRecipeId;
  recipeRevisionId: SourceRecipeRevisionId;
}) =>
  Effect.gen(function* () {
    const revisionReferenceCount = yield* rows.sources.countByRecipeRevisionId(
      input.recipeRevisionId,
    );
    if (revisionReferenceCount === 0) {
      yield* rows.sourceRecipeDocuments.removeByRevisionId(input.recipeRevisionId);
      yield* rows.sourceRecipeSchemaBundles.removeByRevisionId(input.recipeRevisionId);
      yield* rows.sourceRecipeOperations.removeByRevisionId(input.recipeRevisionId);
    }

    const recipeReferenceCount = yield* rows.sources.countByRecipeId(input.recipeId);
    if (recipeReferenceCount > 0) {
      return;
    }

    const recipeRevisions = yield* rows.sourceRecipeRevisions.listByRecipeId(input.recipeId);
    yield* Effect.forEach(
      recipeRevisions,
      (recipeRevision) =>
        Effect.all([
          rows.sourceRecipeDocuments.removeByRevisionId(recipeRevision.id),
          rows.sourceRecipeSchemaBundles.removeByRevisionId(recipeRevision.id),
          rows.sourceRecipeOperations.removeByRevisionId(recipeRevision.id),
        ]),
      { discard: true },
    );
    yield* rows.sourceRecipeRevisions.removeByRecipeId(input.recipeId);
    yield* rows.sourceRecipes.removeById(input.recipeId);
  });

export const removeSourceById = (rows: SqlControlPlaneRows, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}) =>
  Effect.gen(function* () {
    const sourceRecord = yield* rows.sources.getByWorkspaceAndId(input.workspaceId, input.sourceId);
    if (Option.isNone(sourceRecord)) {
      return false;
    }

    yield* rows.sourceAuthSessions.removeByWorkspaceAndSourceId(
      input.workspaceId,
      input.sourceId,
    );
    yield* rows.sourceOauthClients.removeByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });
    yield* removeCredentialsForSource(rows, input);
    const removed = yield* rows.sources.removeByWorkspaceAndId(input.workspaceId, input.sourceId);
    if (!removed) {
      return false;
    }

    yield* cleanupOrphanedRecipeData(rows, {
      recipeId: sourceRecord.value.recipeId,
      recipeRevisionId: sourceRecord.value.recipeRevisionId,
    });

    return true;
  });

export const persistSource = (
  rows: SqlControlPlaneRows,
  source: Source,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
) =>
  Effect.gen(function* () {
    const existing = yield* rows.sources.getByWorkspaceAndId(source.workspaceId, source.id);
    const existingCredentials = yield* rows.credentials.listByWorkspaceAndSourceId({
      workspaceId: source.workspaceId,
      sourceId: source.id,
    });
    const existingCredential = selectExactCredential({
      credentials: existingCredentials,
      actorAccountId: options.actorAccountId,
      slot: "runtime",
    });
    const existingImportCredential = selectExactCredential({
      credentials: existingCredentials,
      actorAccountId: options.actorAccountId,
      slot: "import",
    });

    const nextRecipeId = stableSourceRecipeId(source);
    const nextRecipeRevisionId = Option.isSome(existing) && existing.value.recipeId === nextRecipeId
      ? existing.value.recipeRevisionId
      : stableSourceRecipeRevisionId(source);
    const existingTargetRevision = yield* rows.sourceRecipeRevisions.getById(nextRecipeRevisionId);
    const nextRevision = createSourceRecipeRevisionRecord({
      source,
      recipeId: nextRecipeId,
      recipeRevisionId: nextRecipeRevisionId,
      revisionNumber: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.revisionNumber
        : 1,
      manifestJson: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.manifestJson
        : null,
      manifestHash: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.manifestHash
        : null,
      materializationHash: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.materializationHash
        : null,
    });

    const nextRecipe = createSourceRecipeRecord({
      source,
      recipeId: nextRecipeId,
      latestRevisionId: nextRevision.id,
    });

    const { sourceRecord, runtimeCredential, importCredential } = splitSourceForStorage({
      source,
      recipeId: nextRecipe.id,
      recipeRevisionId: nextRevision.id,
      actorAccountId: options.actorAccountId,
      existingRuntimeCredentialId: existingCredential?.id ?? null,
      existingImportCredentialId: existingImportCredential?.id ?? null,
    });

    if (Option.isNone(existing)) {
      yield* rows.sources.insert(sourceRecord);
    } else {
      const {
        id: _id,
        workspaceId: _workspaceId,
        createdAt: _createdAt,
        ...patch
      } = sourceRecord;
      yield* rows.sources.update(source.workspaceId, source.id, patch);
    }

    yield* rows.sourceRecipes.upsert(nextRecipe);
    yield* rows.sourceRecipeRevisions.upsert(nextRevision);

    if (
      Option.isSome(existing)
      && (
        existing.value.recipeId !== nextRecipeId
        || existing.value.recipeRevisionId !== nextRecipeRevisionId
      )
    ) {
      yield* cleanupOrphanedRecipeData(rows, {
        recipeId: existing.value.recipeId,
        recipeRevisionId: existing.value.recipeRevisionId,
      });
    }

    if (runtimeCredential === null) {
      yield* rows.credentials.removeByWorkspaceSourceAndActor({
        workspaceId: source.workspaceId,
        sourceId: source.id,
        actorAccountId: options.actorAccountId ?? null,
        slot: "runtime",
      });
    } else {
      yield* rows.credentials.upsert(runtimeCredential);
    }

    yield* cleanupCredentialSecretRefs(rows, {
      previous: existingCredential ?? null,
      next: runtimeCredential,
    });

    if (importCredential === null) {
      yield* rows.credentials.removeByWorkspaceSourceAndActor({
        workspaceId: source.workspaceId,
        sourceId: source.id,
        actorAccountId: options.actorAccountId ?? null,
        slot: "import",
      });
    } else {
      yield* rows.credentials.upsert(importCredential);
    }

    yield* cleanupCredentialSecretRefs(rows, {
      previous: existingImportCredential ?? null,
      next: importCredential,
    });

    return source;
  });
