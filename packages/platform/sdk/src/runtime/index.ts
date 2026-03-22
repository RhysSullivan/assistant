import {
  createToolCatalogFromTools,
  makeToolInvokerFromTools,
  type ToolMap,
} from "@executor/codemode-core";
import { clearAllMcpConnectionPools } from "@executor/source-mcp";
import type { LocalInstallation } from "#schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { RuntimeSourceAuthMaterialLive } from "./auth/source-auth-material";
import { RuntimeSourceCatalogStoreLive } from "./catalog/source/runtime";
import { reconcileMissingSourceCatalogArtifacts } from "./catalog/source/reconcile";
import { RuntimeSourceCatalogSyncLive } from "./catalog/source/sync";
import { createLiveExecutionManager, LiveExecutionManagerService } from "./execution/live";
import { RuntimeExecutionResolverLive } from "./execution/workspace/environment";
import type { CreateWorkspaceInternalToolMap, WorkspaceInternalToolContext } from "./execution/workspace/tool-invoker";
import type {
  LoadedLocalExecutorConfig,
  ResolvedLocalWorkspaceContext,
} from "./local/config";
import type { LocalExecutorConfig } from "#schema";
import type { LocalControlPlanePersistence } from "./local/control-plane-store";
import {
  type DeleteSecretMaterial,
  type ResolveSecretMaterial,
  SecretMaterialDeleterService,
  SecretMaterialResolverService,
  SecretMaterialStorerService,
  SecretMaterialUpdaterService,
  type StoreSecretMaterial,
  type UpdateSecretMaterial,
} from "./local/secret-material-providers";
import type { LocalSourceArtifact } from "./local/source-artifacts";
import {
  type RuntimeLocalWorkspaceState,
  RuntimeLocalWorkspaceLive,
} from "./local/runtime-context";
import {
  type LocalToolRuntime,
  type LocalToolRuntimeLoaderShape,
  LocalToolRuntimeLoaderService,
} from "./local/tools";
import {
  InstallationStore,
  makeLocalStorageLayer,
  type InstallationStoreShape,
  type SourceArtifactStoreShape,
  type WorkspaceConfigStoreShape,
  type WorkspaceStateStoreShape,
} from "./local/storage";
import type { LocalWorkspaceState } from "./local/workspace-state";
import { synchronizeLocalWorkspaceState } from "./local/workspace-sync";
import { ControlPlaneStore, type ControlPlaneStoreShape } from "./store";
import { RuntimeSourceAuthServiceLive } from "./sources/source-auth-service";
import { RuntimeSourceStoreLive } from "./sources/source-store";

export * from "./execution/state";
export * from "./sources/executor-tools";
export * from "./execution/live";
export * from "./local/config";
export * from "./local/control-plane-store";
export * from "./local/errors";
export * from "./local/installation";
export * from "./local/runtime-context";
export * from "./local/storage";
export * from "./local/source-artifacts";
export * from "./local/tools";
export * from "./catalog/schema-type-signature";
export * from "./catalog/source/runtime";
export * from "./catalog/source/sync";
export * from "./sources/source-auth-service";
export * from "./local/secret-material-providers";
export * from "./sources/source-credential-interactions";
export * from "./sources/source-adapters/mcp";
export * from "./sources/source-store";
export * from "./store";
export * from "./execution/workspace/environment";
export * from "../sources/inspection";
export * from "../sources/discovery";
export * from "./execution/service";
export type {
  CreateWorkspaceInternalToolMap,
  WorkspaceInternalToolContext,
} from "./execution/workspace/tool-invoker";
export {
  builtInSourceAdapters,
  connectableSourceAdapters,
  executorAddableSourceAdapters,
  localConfigurableSourceAdapters,
  getSourceAdapter,
  getSourceAdapterForSource,
  findSourceAdapterByProviderKey,
  sourceBindingStateFromSource,
  sourceAdapterCatalogKind,
  sourceAdapterRequiresInteractiveConnect,
  sourceAdapterUsesCredentialManagedAuth,
  isInternalSourceAdapter,
} from "./sources/source-adapters";

export type RuntimeControlPlaneOptions = {
  executionResolver?: ResolveExecutionEnvironment;
  createInternalToolMap?: CreateWorkspaceInternalToolMap;
  resolveSecretMaterial?: ResolveSecretMaterial;
  getLocalServerBaseUrl?: () => string | undefined;
};

type ResolveExecutionEnvironment = import("./execution/state").ResolveExecutionEnvironment;

const detailsFromCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toRuntimeBootstrapError = (cause: unknown): Error => {
  const details = detailsFromCause(cause);
  return new Error(`Failed initializing runtime: ${details}`);
};

export type RuntimeControlPlaneLayer = Layer.Layer<any, never, never>;

export type BoundInstallationStore = {
  load: () => Effect.Effect<LocalInstallation, Error, never>;
  getOrProvision: () => Effect.Effect<LocalInstallation, Error, never>;
};

export type BoundWorkspaceConfigStore = {
  load: () => Effect.Effect<LoadedLocalExecutorConfig, Error, never>;
  writeProject: (
    config: LocalExecutorConfig,
  ) => Effect.Effect<void, Error, never>;
  resolveRelativePath: WorkspaceConfigStoreShape["resolveRelativePath"];
};

export type BoundWorkspaceStateStore = {
  load: () => Effect.Effect<LocalWorkspaceState, Error, never>;
  write: (
    state: LocalWorkspaceState,
  ) => Effect.Effect<void, Error, never>;
};

export type BoundSourceArtifactStore = {
  build: SourceArtifactStoreShape["build"];
  read: (
    sourceId: string,
  ) => Effect.Effect<LocalSourceArtifact | null, Error, never>;
  write: (input: {
    sourceId: string;
    artifact: LocalSourceArtifact;
  }) => Effect.Effect<void, Error, never>;
  remove: (sourceId: string) => Effect.Effect<void, Error, never>;
};

export type BoundLocalToolRuntimeLoader = {
  load: () => ReturnType<LocalToolRuntimeLoaderShape["load"]>;
};

export type RuntimeSecretMaterialServices = {
  resolve: ResolveSecretMaterial;
  store: StoreSecretMaterial;
  delete: DeleteSecretMaterial;
  update: UpdateSecretMaterial;
};

export type RuntimeControlPlaneServices = {
  workspaceContext: ResolvedLocalWorkspaceContext;
  installationStore: BoundInstallationStore;
  workspaceConfigStore: BoundWorkspaceConfigStore;
  workspaceStateStore: BoundWorkspaceStateStore;
  sourceArtifactStore: BoundSourceArtifactStore;
  localToolRuntimeLoader?: BoundLocalToolRuntimeLoader;
  secretMaterial: RuntimeSecretMaterialServices;
  persistence: LocalControlPlanePersistence;
};

const emptyToolRuntime = (): LocalToolRuntime => {
  const tools: ToolMap = {};
  return {
    tools,
    catalog: createToolCatalogFromTools({ tools }),
    toolInvoker: makeToolInvokerFromTools({ tools }),
    toolPaths: new Set(),
  };
};

const toInstallationStoreShape = (
  input: BoundInstallationStore,
): InstallationStoreShape => ({
  load: () => input.load(),
  getOrProvision: () => input.getOrProvision(),
});

const toWorkspaceConfigStoreShape = (
  input: BoundWorkspaceConfigStore,
): WorkspaceConfigStoreShape => ({
  load: () => input.load(),
  writeProject: ({ config }) => input.writeProject(config),
  resolveRelativePath: input.resolveRelativePath,
});

const toWorkspaceStateStoreShape = (
  input: BoundWorkspaceStateStore,
): WorkspaceStateStoreShape => ({
  load: () => input.load(),
  write: ({ state }) => input.write(state),
});

const toSourceArtifactStoreShape = (
  input: BoundSourceArtifactStore,
): SourceArtifactStoreShape => ({
  build: input.build,
  read: ({ sourceId }) => input.read(sourceId),
  write: ({ sourceId, artifact }) => input.write({ sourceId, artifact }),
  remove: ({ sourceId }) => input.remove(sourceId),
});

const makeSecretMaterialLayer = (input: RuntimeSecretMaterialServices) =>
  Layer.mergeAll(
    Layer.succeed(SecretMaterialResolverService, input.resolve),
    Layer.succeed(SecretMaterialStorerService, input.store),
    Layer.succeed(SecretMaterialDeleterService, input.delete),
    Layer.succeed(SecretMaterialUpdaterService, input.update),
  );

export const createRuntimeControlPlaneLayer = (
  input: RuntimeControlPlaneOptions & RuntimeControlPlaneServices & {
    store: ControlPlaneStoreShape;
    localWorkspaceState: RuntimeLocalWorkspaceState;
    liveExecutionManager: ReturnType<typeof createLiveExecutionManager>;
  },
) => {
  const storageLayer = makeLocalStorageLayer({
    installationStore: toInstallationStoreShape(input.installationStore),
    workspaceConfigStore: toWorkspaceConfigStoreShape(input.workspaceConfigStore),
    workspaceStateStore: toWorkspaceStateStoreShape(input.workspaceStateStore),
    sourceArtifactStore: toSourceArtifactStoreShape(input.sourceArtifactStore),
  });
  const localToolRuntimeLayer = Layer.succeed(
    LocalToolRuntimeLoaderService,
    LocalToolRuntimeLoaderService.of({
      load: () =>
        input.localToolRuntimeLoader?.load() ?? Effect.succeed(emptyToolRuntime()),
    }),
  );

  const baseLayer = Layer.mergeAll(
    Layer.succeed(ControlPlaneStore, input.store),
    RuntimeLocalWorkspaceLive(input.localWorkspaceState),
    storageLayer,
    Layer.succeed(LiveExecutionManagerService, input.liveExecutionManager),
  );

  const secretMaterialLayer = makeSecretMaterialLayer(input.secretMaterial).pipe(
    Layer.provide(baseLayer),
  );

  const sourceStoreLayer = RuntimeSourceStoreLive.pipe(Layer.provide(baseLayer));

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
    createInternalToolMap: input.createInternalToolMap,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        baseLayer,
        secretMaterialLayer,
        sourceStoreLayer,
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
  managedRuntime: ManagedRuntime.ManagedRuntime<any, never>;
  runtimeLayer: RuntimeControlPlaneLayer;
  close: () => Promise<void>;
};

export const provideControlPlaneRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime: ControlPlaneRuntime,
): Effect.Effect<A, E | never, never> =>
  effect.pipe(Effect.provide(runtime.managedRuntime));

export const createControlPlaneRuntimeFromServices = (input: {
  services: RuntimeControlPlaneServices;
} & RuntimeControlPlaneOptions): Effect.Effect<ControlPlaneRuntime, Error> =>
  (Effect.gen(function* () {
    const localInstallation = yield* input.services.installationStore
      .getOrProvision()
      .pipe(Effect.mapError(toRuntimeBootstrapError));

    const loadedLocalConfig = yield* input.services.workspaceConfigStore
      .load()
      .pipe(Effect.mapError(toRuntimeBootstrapError));

    const effectiveLocalConfig = yield* synchronizeLocalWorkspaceState({
      context: input.services.workspaceContext,
      loadedConfig: loadedLocalConfig,
    })
      .pipe(
        Effect.provide(
          makeLocalStorageLayer({
            installationStore: toInstallationStoreShape(
              input.services.installationStore,
            ),
            workspaceConfigStore: toWorkspaceConfigStoreShape(
              input.services.workspaceConfigStore,
            ),
            workspaceStateStore: toWorkspaceStateStoreShape(
              input.services.workspaceStateStore,
            ),
            sourceArtifactStore: toSourceArtifactStoreShape(
              input.services.sourceArtifactStore,
            ),
          }),
        ),
      )
      .pipe(Effect.mapError(toRuntimeBootstrapError));

    const runtimeLocalWorkspaceState: RuntimeLocalWorkspaceState = {
      context: input.services.workspaceContext,
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
      ...input,
      ...input.services,
      store: input.services.persistence.rows,
      localWorkspaceState: runtimeLocalWorkspaceState,
      liveExecutionManager,
    });
    const managedRuntime = ManagedRuntime.make(concreteRuntimeLayer);
    yield* managedRuntime.runtimeEffect;
    yield* reconcileMissingSourceCatalogArtifacts({
      workspaceId: localInstallation.workspaceId,
      actorAccountId: localInstallation.accountId,
    }).pipe(
      Effect.provide(managedRuntime),
      Effect.catchAll(() => Effect.void),
    );

    return {
      persistence: input.services.persistence,
      localInstallation,
      managedRuntime,
      runtimeLayer: concreteRuntimeLayer as RuntimeControlPlaneLayer,
      close: async () => {
        await Effect.runPromise(clearAllMcpConnectionPools()).catch(
          () => undefined,
        );
        await managedRuntime.dispose().catch(() => undefined);
        await input.services.persistence.close().catch(() => undefined);
      },
    };
  }) as Effect.Effect<ControlPlaneRuntime, Error>);
