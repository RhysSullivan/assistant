import type {
  AccountId,
  AuthArtifact,
  CredentialSlot,
  ProviderAuthGrant,
  Source,
  WorkspaceId,
} from "#schema";
import { decodeProviderGrantRefAuthArtifactConfig } from "#schema";
import * as Effect from "effect/Effect";

import { authArtifactSecretMaterialRefs } from "../../auth/auth-artifacts";
import { removeAuthLeaseAndSecrets } from "../../auth/auth-leases";
import { createDefaultSecretMaterialDeleter } from "../../local/secret-material-providers";
import type { ControlPlaneStoreShape } from "../../store";

const secretRefKey = (ref: { providerId: string; handle: string }): string =>
  `${ref.providerId}:${ref.handle}`;

export const cleanupAuthArtifactSecretRefs = (
  rows: ControlPlaneStoreShape,
  input: {
    previous: AuthArtifact | null;
    next: AuthArtifact | null;
  },
) =>
  Effect.gen(function* () {
    if (input.previous === null) {
      return;
    }

    const deleteSecretMaterial = createDefaultSecretMaterialDeleter({ rows });
    const nextRefKeys = new Set(
      (input.next === null ? [] : authArtifactSecretMaterialRefs(input.next)).map(
        secretRefKey,
      ),
    );
    const refsToDelete = authArtifactSecretMaterialRefs(input.previous).filter(
      (ref) => !nextRefKeys.has(secretRefKey(ref)),
    );

    yield* Effect.forEach(
      refsToDelete,
      (ref) => Effect.either(deleteSecretMaterial(ref)),
      { discard: true },
    );
  });

export const providerGrantIdsFromArtifacts = (
  artifacts: ReadonlyArray<
    Pick<AuthArtifact, "artifactKind" | "configJson"> | null
  >,
): ReadonlySet<ProviderAuthGrant["id"]> =>
  new Set(
    artifacts
      .flatMap((artifact) =>
        artifact ? [decodeProviderGrantRefAuthArtifactConfig(artifact)] : []
      )
      .flatMap((config) => (config ? [config.grantId] : [])),
  );

export const selectPreferredAuthArtifact = (input: {
  authArtifacts: ReadonlyArray<AuthArtifact>;
  actorAccountId?: AccountId | null;
  slot: CredentialSlot;
}): AuthArtifact | null => {
  const matchingSlot = input.authArtifacts.filter(
    (artifact) => artifact.slot === input.slot,
  );

  if (input.actorAccountId !== undefined) {
    const exact = matchingSlot.find(
      (artifact) => artifact.actorAccountId === input.actorAccountId,
    );
    if (exact) {
      return exact;
    }
  }

  return matchingSlot.find((artifact) => artifact.actorAccountId === null) ?? null;
};

export const selectExactAuthArtifact = (input: {
  authArtifacts: ReadonlyArray<AuthArtifact>;
  actorAccountId?: AccountId | null;
  slot: CredentialSlot;
}): AuthArtifact | null =>
  input.authArtifacts.find(
    (artifact) =>
      artifact.slot === input.slot &&
      artifact.actorAccountId === (input.actorAccountId ?? null),
  ) ?? null;

export const removeAuthArtifactsForSource = (
  rows: ControlPlaneStoreShape,
  input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
  },
) =>
  Effect.gen(function* () {
    const existingAuthArtifacts = yield* rows.authArtifacts.listByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    yield* rows.authArtifacts.removeByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    yield* Effect.forEach(
      existingAuthArtifacts,
      (artifact) =>
        removeAuthLeaseAndSecrets(rows, {
          authArtifactId: artifact.id,
        }),
      { discard: true },
    );

    yield* Effect.forEach(
      existingAuthArtifacts,
      (artifact) =>
        cleanupAuthArtifactSecretRefs(rows, {
          previous: artifact,
          next: null,
        }),
      { discard: true },
    );

    return existingAuthArtifacts.length;
  });
