import type {
  ScopeId,
  Source,
} from "#schema";
import * as Effect from "effect/Effect";

import {
  removeAuthLeaseAndSecrets,
} from "../../auth/auth-leases";
import {
  clearProviderGrantOrphanedAt,
  markProviderGrantOrphanedIfUnused,
} from "../../auth/provider-grant-lifecycle";
import type {
  DeleteSecretMaterial,
} from "../../scope/secret-material-providers";
import type {
  LocalScopeState,
} from "../../scope-state";
import {
  stableSourceCatalogId,
  stableSourceCatalogRevisionId,
  splitSourceForStorage,
} from "../source-definitions";
import {
  cleanupAuthArtifactSecretRefs,
  providerGrantIdsFromArtifacts,
  removeAuthArtifactsForSource,
  selectExactAuthArtifact,
} from "./auth";
import {
  configSourceFromLocalSource,
  cloneJson,
  deriveLocalSourceId,
} from "./config";
import {
  type RuntimeSourceStoreDeps,
  resolveRuntimeLocalScopeFromDeps,
} from "./deps";
import {
  loadSourceByIdWithDeps,
  shouldRefreshScopeDeclarationsAfterPersist,
  syncScopeSourceTypeDeclarationsWithDeps,
} from "./records";

export const removeSourceByIdWithDeps = (
  deps: RuntimeSourceStoreDeps,
  input: {
    scopeId: ScopeId;
    sourceId: Source["id"];
  },
  deleteSecretMaterial: DeleteSecretMaterial,
): Effect.Effect<boolean, Error, never> =>
  Effect.gen(function* () {
    const localScope = yield* resolveRuntimeLocalScopeFromDeps(
      deps,
      input.scopeId,
    );
    if (!localScope.loadedConfig.config?.sources?.[input.sourceId]) {
      return false;
    }

    const projectConfig = cloneJson(localScope.loadedConfig.projectConfig ?? {});
    const sources = {
      ...projectConfig.sources,
    };
    delete sources[input.sourceId];
    yield* localScope.scopeConfigStore.writeProject({
      config: {
        ...projectConfig,
        sources,
      },
    });

    const { [input.sourceId]: _removedSource, ...remainingSources } =
      localScope.scopeState.sources;
    const scopeState: LocalScopeState = {
      ...localScope.scopeState,
      sources: remainingSources,
    };
    yield* localScope.scopeStateStore.write({
      state: scopeState,
    });
    yield* localScope.sourceArtifactStore.remove({
      sourceId: input.sourceId,
    });
    const existingAuthArtifacts =
      yield* deps.executorState.authArtifacts.listByScopeAndSourceId({
        scopeId: input.scopeId,
        sourceId: input.sourceId,
      });
    const removedGrantIds = providerGrantIdsFromArtifacts(existingAuthArtifacts);

    yield* deps.executorState.sourceAuthSessions.removeByScopeAndSourceId(
      input.scopeId,
      input.sourceId,
    );
    yield* deps.executorState.sourceOauthClients.removeByScopeAndSourceId({
      scopeId: input.scopeId,
      sourceId: input.sourceId,
    });
    yield* removeAuthArtifactsForSource(deps.executorState, input, deleteSecretMaterial);
    yield* Effect.forEach(
      [...removedGrantIds],
      (grantId) =>
        markProviderGrantOrphanedIfUnused(deps.executorState, {
          scopeId: input.scopeId,
          grantId,
        }),
      { discard: true },
    );
    yield* syncScopeSourceTypeDeclarationsWithDeps(deps, input.scopeId);

    return true;
  });

export const persistSourceWithDeps = (
  deps: RuntimeSourceStoreDeps,
  source: Source,
  options: {
    actorScopeId?: ScopeId | null;
  } = {},
  deleteSecretMaterial: DeleteSecretMaterial,
): Effect.Effect<Source, Error, never> =>
  Effect.gen(function* () {
    const localScope = yield* resolveRuntimeLocalScopeFromDeps(
      deps,
      source.scopeId,
    );
    const nextSource = {
      ...source,
      id:
        localScope.loadedConfig.config?.sources?.[source.id] ||
        localScope.scopeState.sources[source.id]
          ? source.id
          : deriveLocalSourceId(
              source,
              new Set(Object.keys(localScope.loadedConfig.config?.sources ?? {})),
            ),
    } satisfies Source;
    const existingAuthArtifacts =
      yield* deps.executorState.authArtifacts.listByScopeAndSourceId({
        scopeId: nextSource.scopeId,
        sourceId: nextSource.id,
      });
    const existingRuntimeAuthArtifact = selectExactAuthArtifact({
      authArtifacts: existingAuthArtifacts,
      actorScopeId: options.actorScopeId,
      slot: "runtime",
    });
    const existingImportAuthArtifact = selectExactAuthArtifact({
      authArtifacts: existingAuthArtifacts,
      actorScopeId: options.actorScopeId,
      slot: "import",
    });
    const projectConfig = cloneJson(localScope.loadedConfig.projectConfig ?? {});
    const sources = {
      ...projectConfig.sources,
    };
    const existingConfigSource = sources[nextSource.id];
    sources[nextSource.id] = configSourceFromLocalSource({
      source: nextSource,
      existingConfigAuth: existingConfigSource?.connection.auth,
      config: localScope.loadedConfig.config,
    });
    yield* localScope.scopeConfigStore.writeProject({
      config: {
        ...projectConfig,
        sources,
      },
    });

    const { runtimeAuthArtifact, importAuthArtifact } = splitSourceForStorage({
      source: nextSource,
      catalogId: stableSourceCatalogId(nextSource),
      catalogRevisionId: stableSourceCatalogRevisionId(nextSource),
      actorScopeId: options.actorScopeId,
      existingRuntimeAuthArtifactId: existingRuntimeAuthArtifact?.id ?? null,
      existingImportAuthArtifactId: existingImportAuthArtifact?.id ?? null,
    });

    if (runtimeAuthArtifact === null) {
      if (existingRuntimeAuthArtifact !== null) {
        yield* removeAuthLeaseAndSecrets(deps.executorState, {
          authArtifactId: existingRuntimeAuthArtifact.id,
        }, deleteSecretMaterial);
      }
      yield* deps.executorState.authArtifacts.removeByScopeSourceAndActor({
        scopeId: nextSource.scopeId,
        sourceId: nextSource.id,
        actorScopeId: options.actorScopeId ?? null,
        slot: "runtime",
      });
    } else {
      yield* deps.executorState.authArtifacts.upsert(runtimeAuthArtifact);
      if (
        existingRuntimeAuthArtifact !== null &&
        existingRuntimeAuthArtifact.id !== runtimeAuthArtifact.id
      ) {
        yield* removeAuthLeaseAndSecrets(deps.executorState, {
          authArtifactId: existingRuntimeAuthArtifact.id,
        }, deleteSecretMaterial);
      }
    }

    yield* cleanupAuthArtifactSecretRefs(deps.executorState, {
      previous: existingRuntimeAuthArtifact ?? null,
      next: runtimeAuthArtifact,
    }, deleteSecretMaterial);

    if (importAuthArtifact === null) {
      if (existingImportAuthArtifact !== null) {
        yield* removeAuthLeaseAndSecrets(deps.executorState, {
          authArtifactId: existingImportAuthArtifact.id,
        }, deleteSecretMaterial);
      }
      yield* deps.executorState.authArtifacts.removeByScopeSourceAndActor({
        scopeId: nextSource.scopeId,
        sourceId: nextSource.id,
        actorScopeId: options.actorScopeId ?? null,
        slot: "import",
      });
    } else {
      yield* deps.executorState.authArtifacts.upsert(importAuthArtifact);
      if (
        existingImportAuthArtifact !== null &&
        existingImportAuthArtifact.id !== importAuthArtifact.id
      ) {
        yield* removeAuthLeaseAndSecrets(deps.executorState, {
          authArtifactId: existingImportAuthArtifact.id,
        }, deleteSecretMaterial);
      }
    }

    yield* cleanupAuthArtifactSecretRefs(deps.executorState, {
      previous: existingImportAuthArtifact ?? null,
      next: importAuthArtifact,
    }, deleteSecretMaterial);

    const previousGrantIds = providerGrantIdsFromArtifacts([
      existingRuntimeAuthArtifact,
      existingImportAuthArtifact,
    ]);
    const nextGrantIds = providerGrantIdsFromArtifacts([
      runtimeAuthArtifact,
      importAuthArtifact,
    ]);

    yield* Effect.forEach(
      [...nextGrantIds],
      (grantId) =>
        clearProviderGrantOrphanedAt(deps.executorState, {
          grantId,
        }),
      { discard: true },
    );
    yield* Effect.forEach(
      [...previousGrantIds].filter((grantId) => !nextGrantIds.has(grantId)),
      (grantId) =>
        markProviderGrantOrphanedIfUnused(deps.executorState, {
          scopeId: nextSource.scopeId,
          grantId,
        }),
      { discard: true },
    );

    const existingSourceState = localScope.scopeState.sources[nextSource.id];
    const scopeState: LocalScopeState = {
      ...localScope.scopeState,
      sources: {
        ...localScope.scopeState.sources,
        [nextSource.id]: {
          status: nextSource.status,
          lastError: nextSource.lastError,
          sourceHash: nextSource.sourceHash,
          createdAt: existingSourceState?.createdAt ?? nextSource.createdAt,
          updatedAt: nextSource.updatedAt,
        },
      },
    };
    yield* localScope.scopeStateStore.write({
      state: scopeState,
    });

    if (shouldRefreshScopeDeclarationsAfterPersist(nextSource)) {
      yield* syncScopeSourceTypeDeclarationsWithDeps(
        deps,
        nextSource.scopeId,
        options,
      );
    }

    return yield* loadSourceByIdWithDeps(deps, {
      scopeId: nextSource.scopeId,
      sourceId: nextSource.id,
      actorScopeId: options.actorScopeId,
    });
  }).pipe(
    Effect.withSpan("source.store.persist", {
      attributes: {
        "executor.scope.id": source.scopeId,
        "executor.source.id": source.id,
        "executor.source.kind": source.kind,
        "executor.source.status": source.status,
      },
    }),
  );
