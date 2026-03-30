import type {
  ScopeId,
} from "#schema";
import * as Effect from "effect/Effect";

import type {
  LoadedExecutorScopeConfig,
} from "../../scope-config";
import {
  SourceTypeDeclarationsRefresherService,
  type SourceTypeDeclarationsRefresherShape,
} from "../../catalog/source/type-declarations";
import {
  RuntimeLocalScopeMismatchError,
  RuntimeLocalScopeUnavailableError,
} from "../../scope-errors";
import {
  requireRuntimeLocalScope,
  type RuntimeLocalScopeState,
} from "../../scope/runtime-context";
import type {
  SourceArtifactStoreShape,
  ScopeStorageServices,
  ScopeConfigStoreShape,
  ScopeStateStoreShape,
} from "../../scope/storage";
import {
  SourceArtifactStore,
  ScopeConfigStore,
  ScopeStateStore,
} from "../../scope/storage";
import type {
  LocalScopeState,
} from "../../scope-state";
import type {
  ExecutorStateStoreShape,
} from "../../executor-state-store";

export type RuntimeSourceStoreDeps = {
  executorState: ExecutorStateStoreShape;
  runtimeLocalScope: RuntimeLocalScopeState;
  scopeConfigStore: ScopeConfigStoreShape;
  scopeStateStore: ScopeStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
  sourceTypeDeclarationsRefresher: SourceTypeDeclarationsRefresherShape;
};

export type ResolvedSourceStoreScope = {
  installation: {
    scopeId: ScopeId;
    actorScopeId: ScopeId;
  };
  scopeConfigStore: ScopeConfigStoreShape;
  scopeStateStore: ScopeStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
  loadedConfig: LoadedExecutorScopeConfig;
  scopeState: LocalScopeState;
};

export type RuntimeSourceStoreServices =
  ScopeStorageServices | SourceTypeDeclarationsRefresherService;

export const resolveRuntimeLocalScopeFromDeps = (
  deps: RuntimeSourceStoreDeps,
  scopeId: ScopeId,
): Effect.Effect<
  ResolvedSourceStoreScope,
  | RuntimeLocalScopeUnavailableError
  | RuntimeLocalScopeMismatchError
  | Error,
  never
> =>
  Effect.gen(function* () {
    if (deps.runtimeLocalScope.installation.scopeId !== scopeId) {
      return yield* new RuntimeLocalScopeMismatchError({
          message: `Runtime local scope mismatch: expected ${scopeId}, got ${deps.runtimeLocalScope.installation.scopeId}`,
          requestedScopeId: scopeId,
          activeScopeId: deps.runtimeLocalScope.installation.scopeId,
        });
    }

    const loadedConfig = yield* deps.scopeConfigStore.load();
    const scopeState = yield* deps.scopeStateStore.load();

    return {
      installation: deps.runtimeLocalScope.installation,
      scopeConfigStore: deps.scopeConfigStore,
      scopeStateStore: deps.scopeStateStore,
      sourceArtifactStore: deps.sourceArtifactStore,
      loadedConfig,
      scopeState,
    };
  });

export const loadRuntimeSourceStoreDeps = (
  executorState: ExecutorStateStoreShape,
  scopeId: ScopeId,
): Effect.Effect<
  RuntimeSourceStoreDeps,
  | RuntimeLocalScopeUnavailableError
  | RuntimeLocalScopeMismatchError
  | Error,
  RuntimeSourceStoreServices
> =>
  Effect.gen(function* () {
    const runtimeLocalScope = yield* requireRuntimeLocalScope(scopeId);
    const scopeConfigStore = yield* ScopeConfigStore;
    const scopeStateStore = yield* ScopeStateStore;
    const sourceArtifactStore = yield* SourceArtifactStore;
    const sourceTypeDeclarationsRefresher =
      yield* SourceTypeDeclarationsRefresherService;

    return {
      executorState,
      runtimeLocalScope,
      scopeConfigStore,
      scopeStateStore,
      sourceArtifactStore,
      sourceTypeDeclarationsRefresher,
    };
  });
