import { createHash } from "node:crypto";

import type {
  Source,
  StoredSourceRecipeDocumentRecord,
  StoredSourceRecipeOperationRecord,
  StoredSourceRecipeSchemaBundleRecord,
  StoredSourceRecipeRevisionRecord,
} from "#schema";
import type { SqlControlPlaneRows } from "#persistence";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

type SourceBindingRecord =
  Awaited<
    ReturnType<SqlControlPlaneRows["sources"]["getByWorkspaceAndId"]>
  > extends Effect.Effect<Option.Option<infer T>, unknown, never>
    ? T
    : never;

export const normalizeSearchText = (
  ...parts: ReadonlyArray<string | null | undefined>
): string =>
  parts
    .flatMap((part) => (part ? [part.trim()] : []))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const contentHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const loadSourceBindingRecord = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
}): Effect.Effect<SourceBindingRecord, Error, never> =>
  Effect.gen(function* () {
    const sourceRecord = yield* input.rows.sources
      .getByWorkspaceAndId(input.source.workspaceId, input.source.id)
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

    if (Option.isNone(sourceRecord)) {
      return yield* Effect.fail(
        new Error(
          `Source disappeared while syncing recipe data for ${input.source.id}`,
        ),
      );
    }

    return sourceRecord.value;
  });

export type SourceRecipeMaterialization = {
  manifestJson: string | null;
  manifestHash: string | null;
  sourceHash: string | null;
  documents: readonly StoredSourceRecipeDocumentRecord[];
  schemaBundles: readonly StoredSourceRecipeSchemaBundleRecord[];
  operations: readonly StoredSourceRecipeOperationRecord[];
};

const canonicalMaterializationHash = (input: SourceRecipeMaterialization): string => {
  const documents = [...input.documents]
    .map((document) => ({
      documentKind: document.documentKind,
      documentKey: document.documentKey,
      contentHash: document.contentHash,
    }))
    .sort((left, right) =>
      left.documentKind.localeCompare(right.documentKind)
      || left.documentKey.localeCompare(right.documentKey)
      || left.contentHash.localeCompare(right.contentHash)
    );
  const schemaBundles = [...input.schemaBundles]
    .map((bundle) => ({
      bundleKind: bundle.bundleKind,
      contentHash: bundle.contentHash,
    }))
    .sort((left, right) =>
      left.bundleKind.localeCompare(right.bundleKind)
      || left.contentHash.localeCompare(right.contentHash)
    );
  const operations = [...input.operations]
    .map((operation) => ({
      operationKey: operation.operationKey,
      transportKind: operation.transportKind,
      toolId: operation.toolId,
      title: operation.title,
      description: operation.description,
      operationKind: operation.operationKind,
      searchText: operation.searchText,
      inputSchemaJson: operation.inputSchemaJson,
      outputSchemaJson: operation.outputSchemaJson,
      providerKind: operation.providerKind,
      providerDataJson: operation.providerDataJson,
    }))
    .sort((left, right) => left.operationKey.localeCompare(right.operationKey));

  return contentHash(JSON.stringify({
    schemaVersion: 1,
    manifestHash: input.manifestHash,
    manifestJson: input.manifestJson,
    documents,
    schemaBundles,
    operations,
  }));
};

const replaceRevisionContent = (input: {
  rows: SqlControlPlaneRows;
  recipeRevisionId: StoredSourceRecipeRevisionRecord["id"];
  materializationHash: string;
  materialization: SourceRecipeMaterialization;
  updatedAt: number;
}) =>
  Effect.gen(function* () {
    const boundDocuments = input.materialization.documents.map((document) => ({
      ...document,
      recipeRevisionId: input.recipeRevisionId,
    }));
    const boundSchemaBundles = input.materialization.schemaBundles.map((bundle) => ({
      ...bundle,
      recipeRevisionId: input.recipeRevisionId,
    }));
    const boundOperations = input.materialization.operations.map((operation) => ({
      ...operation,
      recipeRevisionId: input.recipeRevisionId,
    }));

    yield* input.rows.sourceRecipeRevisions
      .update(input.recipeRevisionId, {
        manifestJson: input.materialization.manifestJson,
        manifestHash: input.materialization.manifestHash,
        materializationHash: input.materializationHash,
        updatedAt: input.updatedAt,
      })
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

    yield* input.rows.sourceRecipeDocuments
      .replaceForRevision({
        recipeRevisionId: input.recipeRevisionId,
        documents: boundDocuments,
      })
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

    yield* input.rows.sourceRecipeSchemaBundles
      .replaceForRevision({
        recipeRevisionId: input.recipeRevisionId,
        bundles: boundSchemaBundles,
      })
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

    yield* input.rows.sourceRecipeOperations
      .replaceForRevision({
        recipeRevisionId: input.recipeRevisionId,
        operations: boundOperations,
      })
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );
  });

const cleanupOrphanedRevision = (input: {
  rows: SqlControlPlaneRows;
  recipeRevisionId: StoredSourceRecipeRevisionRecord["id"];
}) =>
  Effect.gen(function* () {
    const referenceCount = yield* input.rows.sources.countByRecipeRevisionId(input.recipeRevisionId);
    if (referenceCount > 0) {
      return;
    }

    yield* input.rows.sourceRecipeDocuments.removeByRevisionId(input.recipeRevisionId);
    yield* input.rows.sourceRecipeSchemaBundles.removeByRevisionId(input.recipeRevisionId);
    yield* input.rows.sourceRecipeOperations.removeByRevisionId(input.recipeRevisionId);
    yield* input.rows.sourceRecipeRevisions.removeById(input.recipeRevisionId);
  });

const updateRecipeLatestRevision = (input: {
  rows: SqlControlPlaneRows;
  recipeId: SourceBindingRecord["recipeId"];
  latestRevisionId: StoredSourceRecipeRevisionRecord["id"];
  updatedAt: number;
}) =>
  Effect.gen(function* () {
    const recipe = yield* input.rows.sourceRecipes.getById(input.recipeId);
    if (Option.isNone(recipe)) {
      return yield* Effect.fail(
        new Error(`Recipe disappeared while syncing recipe data for ${input.recipeId}`),
      );
    }

    yield* input.rows.sourceRecipes.upsert({
      ...recipe.value,
      latestRevisionId: input.latestRevisionId,
      updatedAt: input.updatedAt,
    });
  });

export const persistRecipeMaterialization = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  materialization: SourceRecipeMaterialization;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const sourceRecord = yield* loadSourceBindingRecord({
      rows: input.rows,
      source: input.source,
    });
    const now = Date.now();
    const materializationHash = canonicalMaterializationHash(input.materialization);
    const currentRevision = yield* input.rows.sourceRecipeRevisions.getById(
      sourceRecord.recipeRevisionId,
    );

    if (Option.isNone(currentRevision)) {
      return yield* Effect.fail(
        new Error(
          `Recipe revision disappeared while syncing recipe data for ${input.source.id}`,
        ),
      );
    }

    const existingMaterializedRevision = yield* input.rows.sourceRecipeRevisions
      .getByRecipeAndMaterializationHash({
        recipeId: sourceRecord.recipeId,
        materializationHash,
      });

    if (
      Option.isSome(existingMaterializedRevision)
      && existingMaterializedRevision.value.id !== currentRevision.value.id
    ) {
      const movedSource = yield* input.rows.sources.update(
        input.source.workspaceId,
        input.source.id,
        {
          recipeRevisionId: existingMaterializedRevision.value.id,
          sourceHash: input.materialization.sourceHash,
          updatedAt: now,
        },
      );
      if (Option.isNone(movedSource)) {
        return yield* Effect.fail(
          new Error(`Source disappeared while updating recipe materialization for ${input.source.id}`),
        );
      }

      yield* updateRecipeLatestRevision({
        rows: input.rows,
        recipeId: sourceRecord.recipeId,
        latestRevisionId: existingMaterializedRevision.value.id,
        updatedAt: now,
      });
      yield* cleanupOrphanedRevision({
        rows: input.rows,
        recipeRevisionId: currentRevision.value.id,
      });
      return;
    }

    const needsFreshRevision =
      currentRevision.value.materializationHash !== null
      && currentRevision.value.materializationHash !== materializationHash;

    const nextRevisionNumber = needsFreshRevision
      ? yield* input.rows.sourceRecipeRevisions.nextRevisionNumber(sourceRecord.recipeId)
      : null;

    const targetRevision = needsFreshRevision
      ? createFreshTargetRevision({
          currentRevision: currentRevision.value,
          materializationHash,
          now,
          nextRevisionNumber: nextRevisionNumber!,
        })
      : {
          revision: currentRevision.value,
          movedFromRevisionId: null as StoredSourceRecipeRevisionRecord["id"] | null,
        };

    if (needsFreshRevision) {
      yield* input.rows.sourceRecipeRevisions.upsert(targetRevision.revision);
      const movedSource = yield* input.rows.sources.update(
        input.source.workspaceId,
        input.source.id,
        {
          recipeRevisionId: targetRevision.revision.id,
          sourceHash: input.materialization.sourceHash,
          updatedAt: now,
        },
      );
      if (Option.isNone(movedSource)) {
        return yield* Effect.fail(
          new Error(`Source disappeared while switching recipe materialization for ${input.source.id}`),
        );
      }
    } else {
      const updatedSource = yield* input.rows.sources.update(
        input.source.workspaceId,
        input.source.id,
        {
          sourceHash: input.materialization.sourceHash,
          updatedAt: now,
        },
      );
      if (Option.isNone(updatedSource)) {
        return yield* Effect.fail(
          new Error(`Source disappeared while updating sync metadata for ${input.source.id}`),
        );
      }
    }

    yield* replaceRevisionContent({
      rows: input.rows,
      recipeRevisionId: targetRevision.revision.id,
      materializationHash,
      materialization: input.materialization,
      updatedAt: now,
    });
    yield* updateRecipeLatestRevision({
      rows: input.rows,
      recipeId: sourceRecord.recipeId,
      latestRevisionId: targetRevision.revision.id,
      updatedAt: now,
    });

    if (targetRevision.movedFromRevisionId !== null) {
      yield* cleanupOrphanedRevision({
        rows: input.rows,
        recipeRevisionId: targetRevision.movedFromRevisionId,
      });
    }
  });

const createFreshTargetRevision = (input: {
  currentRevision: StoredSourceRecipeRevisionRecord;
  materializationHash: string;
  now: number;
  nextRevisionNumber: number;
}): {
  revision: StoredSourceRecipeRevisionRecord;
  movedFromRevisionId: StoredSourceRecipeRevisionRecord["id"] | null;
} => ({
  revision: {
    ...input.currentRevision,
    id: `src_recipe_rev_${crypto.randomUUID()}` as StoredSourceRecipeRevisionRecord["id"],
    revisionNumber: input.nextRevisionNumber,
    manifestJson: null,
    manifestHash: null,
    materializationHash: input.materializationHash,
    createdAt: input.now,
    updatedAt: input.now,
  },
  movedFromRevisionId: input.currentRevision.id,
});
