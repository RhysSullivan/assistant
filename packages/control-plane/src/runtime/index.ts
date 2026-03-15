import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import { NodeFileSystem } from "@effect/platform-node";

import { type ControlPlaneApiRuntimeContext } from "#api";
import type { LocalInstallation } from "#schema";

import { type ResolveExecutionEnvironment } from "./execution-state";
import {
  createLiveExecutionManager,
  LiveExecutionManagerService,
} from "./live-execution";
import {
  createLocalControlPlanePersistence,
  type LocalControlPlanePersistence,
} from "./local-control-plane-store";
import {
  resolveLocalWorkspaceContext,
} from "./local-config";
import {
  LocalStorageLive,
  LocalInstallationStore,
  LocalWorkspaceConfigStore,
} from "./local-storage";
import {
  type RuntimeLocalWorkspaceState,
  RuntimeLocalWorkspaceLive,
} from "./local-runtime-context";
import { LocalToolRuntimeLoaderLive } from "./local-tools";
import { synchronizeLocalWorkspaceState } from "./local-workspace-sync";
import { ControlPlaneStore, type ControlPlaneStoreShape } from "./store";
import { RuntimeSourceStoreLive } from "./source-store";
import { RuntimeSourceCatalogStoreLive } from "./source-catalog-runtime";
import { RuntimeSourceAuthMaterialLive } from "./source-auth-material";
import { RuntimeSourceCatalogSyncLive } from "./source-catalog-sync";
import {
  RuntimeSourceAuthServiceLive,
} from "./source-auth-service";
import type { ResolveSecretMaterial } from "./secret-material-providers";
import { SecretMaterialLive } from "./secret-material-providers";
import {
  RuntimeExecutionResolverLive,
} from "./workspace-execution-environment";

export * from "./execution-state";
export * from "./executor-tools";
export * from "./live-execution";
export * from "./local-config";
export * from "./local-installation";
export * from "./local-storage";
export * from "./local-source-artifacts";
export * from "./local-tools";
export * from "./schema-type-signature";
export * from "./source-auth-service";
export * from "./secret-material-providers";
export * from "./source-credential-interactions";
export * from "./source-adapters/mcp";
export * from "./store";
export * from "./workspace-execution-environment";
export * from "./source-inspection";
export * from "./source-discovery";
export * from "./execution-service";

export type RuntimeControlPlaneOptions = {
  executionResolver?: ResolveExecutionEnvironment;
  resolveSecretMaterial?: ResolveSecretMaterial;
  getLocalServerBaseUrl?: () => string | undefined;
  workspaceRoot?: string;
};

const detailsFromCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toLocalRuntimeBootstrapError = (
  cause: unknown,
): Error => {
  const details = detailsFromCause(cause);
  return new Error(`Failed initializing local runtime: ${details}`);
};

const closeScope = (scope: Scope.CloseableScope) =>
  Scope.close(scope, Exit.void).pipe(Effect.orDie);

export type RuntimeControlPlaneLayer = Layer.Layer<
  ControlPlaneApiRuntimeContext,
  never,
  never
>;

export const createRuntimeControlPlaneLayer = (
  input: RuntimeControlPlaneOptions & {
    store: ControlPlaneStoreShape;
    localWorkspaceState: RuntimeLocalWorkspaceState;
    liveExecutionManager: ReturnType<typeof createLiveExecutionManager>;
  },
) => {
  const platformLayer = NodeFileSystem.layer;
  const storageLayer = LocalStorageLive.pipe(
    Layer.provide(platformLayer),
  );
  const localToolRuntimeLayer = LocalToolRuntimeLoaderLive.pipe(
    Layer.provide(platformLayer),
  );

  const baseLayer = Layer.mergeAll(
    platformLayer,
    Layer.succeed(ControlPlaneStore, input.store),
    RuntimeLocalWorkspaceLive(input.localWorkspaceState),
    storageLayer,
    Layer.succeed(LiveExecutionManagerService, input.liveExecutionManager),
  );

  const secretMaterialLayer = SecretMaterialLive({
    resolveSecretMaterial: input.resolveSecretMaterial,
  }).pipe(Layer.provide(baseLayer));

  const sourceStoreLayer = RuntimeSourceStoreLive.pipe(
    Layer.provide(baseLayer),
  );

  const sourceCatalogStoreLayer = RuntimeSourceCatalogStoreLive.pipe(
    Layer.provide(Layer.mergeAll(baseLayer, sourceStoreLayer)),
  );

  const sourceAuthMaterialLayer = RuntimeSourceAuthMaterialLive.pipe(
    Layer.provide(Layer.mergeAll(baseLayer, secretMaterialLayer)),
  );

  const sourceCatalogSyncLayer = RuntimeSourceCatalogSyncLive.pipe(
    Layer.provide(
      Layer.mergeAll(baseLayer, secretMaterialLayer, sourceAuthMaterialLayer),
    ),
  );

  const sourceAuthLayer = RuntimeSourceAuthServiceLive({
    getLocalServerBaseUrl: input.getLocalServerBaseUrl,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        baseLayer,
        secretMaterialLayer,
        sourceStoreLayer,
        sourceCatalogSyncLayer,
      ),
    ),
  );

  const executionResolverLayer = RuntimeExecutionResolverLive({
    executionResolver: input.executionResolver,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        baseLayer,
        secretMaterialLayer,
        sourceAuthMaterialLayer,
        sourceCatalogSyncLayer,
        sourceAuthLayer,
        sourceCatalogStoreLayer,
        localToolRuntimeLayer,
      ),
    ),
  );

  return Layer.mergeAll(
    baseLayer,
    secretMaterialLayer,
    sourceStoreLayer,
    sourceAuthMaterialLayer,
    sourceCatalogSyncLayer,
    sourceCatalogStoreLayer,
    localToolRuntimeLayer,
    sourceAuthLayer,
    executionResolverLayer,
  ) as RuntimeControlPlaneLayer;
};

export type ControlPlaneRuntime = {
  persistence: LocalControlPlanePersistence;
  localInstallation: LocalInstallation;
  managedRuntime: ManagedRuntime.ManagedRuntime<ControlPlaneApiRuntimeContext, never>;
  runtimeLayer: RuntimeControlPlaneLayer;
  close: () => Promise<void>;
};

export type CreateControlPlaneRuntimeOptions = RuntimeControlPlaneOptions;

export const provideControlPlaneRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime: ControlPlaneRuntime,
): Effect.Effect<A, E | never, Exclude<R, ControlPlaneApiRuntimeContext>> =>
  effect.pipe(Effect.provide(runtime.managedRuntime));

export const createControlPlaneRuntime = (
  options: CreateControlPlaneRuntimeOptions,
): Effect.Effect<ControlPlaneRuntime, Error> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();

    const localWorkspaceContext = yield* resolveLocalWorkspaceContext({
      workspaceRoot: options.workspaceRoot,
    }).pipe(
      Effect.mapError(toLocalRuntimeBootstrapError),
      Effect.catchAll((error) =>
        closeScope(scope).pipe(Effect.zipRight(Effect.fail(error))),
      ),
    );

    const installationStore = LocalInstallationStore;
    const workspaceConfigStore = LocalWorkspaceConfigStore;

    const localInstallation = yield* installationStore.getOrProvision({
      context: localWorkspaceContext,
    }).pipe(
      Effect.mapError(toLocalRuntimeBootstrapError),
      Effect.catchAll((error) =>
        closeScope(scope).pipe(Effect.zipRight(Effect.fail(error))),
      ),
    );

    const persistence = createLocalControlPlanePersistence(localWorkspaceContext);
    const rows = persistence.rows;

    const loadedLocalConfig = yield* workspaceConfigStore.load(
      localWorkspaceContext,
    ).pipe(
      Effect.mapError(toLocalRuntimeBootstrapError),
      Effect.catchAll((error) =>
        closeScope(scope).pipe(Effect.zipRight(Effect.fail(error))),
      ),
    );

    const effectiveLocalConfig = yield* synchronizeLocalWorkspaceState({
      context: localWorkspaceContext,
      loadedConfig: loadedLocalConfig,
    }).pipe(
      Effect.mapError(toLocalRuntimeBootstrapError),
      Effect.catchAll((error) =>
        closeScope(scope).pipe(Effect.zipRight(Effect.fail(error))),
      ),
    );

    const runtimeLocalWorkspaceState: RuntimeLocalWorkspaceState = {
      context: localWorkspaceContext,
      installation: {
        workspaceId: localInstallation.workspaceId,
        accountId: localInstallation.accountId,
      },
      loadedConfig: {
        ...loadedLocalConfig,
        config: effectiveLocalConfig,
      },
    };
    const liveExecutionManager = createLiveExecutionManager();

    const concreteRuntimeLayer = createRuntimeControlPlaneLayer({
      ...options,
      store: rows,
      localWorkspaceState: runtimeLocalWorkspaceState,
      liveExecutionManager,
    });
    const managedRuntime = ManagedRuntime.make(concreteRuntimeLayer);
    yield* managedRuntime.runtimeEffect;

    return {
      persistence,
      localInstallation,
      managedRuntime,
      runtimeLayer: concreteRuntimeLayer as RuntimeControlPlaneLayer,
      close: () => managedRuntime.dispose().catch(() => {}),
    };
  }).pipe(Effect.provide(NodeFileSystem.layer));
