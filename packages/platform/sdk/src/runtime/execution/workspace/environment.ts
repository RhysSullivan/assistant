import {
  createToolCatalogFromTools,
  makeToolInvokerFromTools,
} from "@executor/codemode-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  ExecutionEnvironment,
  ResolveExecutionEnvironment,
} from "../state";
import {
  createCodeExecutorForRuntime,
  resolveConfiguredExecutionRuntime,
} from "../runtime";
import { createWorkspaceToolInvoker } from "./tool-invoker";
import { RuntimeSourceAuthServiceTag } from "../../sources/source-auth-service";
import { RuntimeSourceCatalogStoreService } from "../../catalog/source/runtime";
import { RuntimeSourceAuthMaterialService } from "../../auth/source-auth-material";
import { RuntimeSourceCatalogSyncService } from "../../catalog/source/sync";
import { getRuntimeLocalWorkspaceOption } from "../../local/runtime-context";
import {
  LocalToolRuntimeLoaderService,
  type LocalToolRuntimeLoaderShape,
  type LocalToolRuntime,
} from "../../local/tools";
import {
  InstallationStore,
  type InstallationStoreShape,
  SourceArtifactStore,
  type SourceArtifactStoreShape,
  WorkspaceConfigStore,
  type WorkspaceConfigStoreShape,
  WorkspaceStateStore,
  type WorkspaceStateStoreShape,
} from "../../local/storage";
import { ControlPlaneStore } from "../../store";
import { RuntimeSourceStoreService } from "../../sources/source-store";
import type { CreateWorkspaceInternalToolMap } from "./tool-invoker";
export {
  createCodeExecutorForRuntime,
  resolveConfiguredExecutionRuntime,
} from "../runtime";

const createEmptyLocalToolRuntime = (): LocalToolRuntime => ({
  tools: {},
  catalog: createToolCatalogFromTools({ tools: {} }),
  toolInvoker: makeToolInvokerFromTools({ tools: {} }),
  toolPaths: new Set<string>(),
});

export const createWorkspaceExecutionEnvironmentResolver =
  (input: {
    controlPlaneStore: Effect.Effect.Success<typeof ControlPlaneStore>;
    sourceStore: Effect.Effect.Success<typeof RuntimeSourceStoreService>;
    sourceCatalogSyncService: Effect.Effect.Success<
      typeof RuntimeSourceCatalogSyncService
    >;
    sourceAuthMaterialService: Effect.Effect.Success<
      typeof RuntimeSourceAuthMaterialService
    >;
    sourceAuthService: Effect.Effect.Success<
      typeof RuntimeSourceAuthServiceTag
    >;
    sourceCatalogStore: Effect.Effect.Success<
      typeof RuntimeSourceCatalogStoreService
    >;
    localToolRuntimeLoader: LocalToolRuntimeLoaderShape;
    installationStore: InstallationStoreShape;
    workspaceConfigStore: WorkspaceConfigStoreShape;
    workspaceStateStore: WorkspaceStateStoreShape;
    sourceArtifactStore: SourceArtifactStoreShape;
    createInternalToolMap?: CreateWorkspaceInternalToolMap;
  }): ResolveExecutionEnvironment =>
  ({ workspaceId, accountId, onElicitation }) =>
    Effect.gen(function* () {
      const runtimeLocalWorkspace = yield* getRuntimeLocalWorkspaceOption();
      const loadedConfig =
        runtimeLocalWorkspace === null
          ? null
          : yield* input.workspaceConfigStore.load(
              runtimeLocalWorkspace.context,
            );
      const localToolRuntime =
        runtimeLocalWorkspace === null
          ? createEmptyLocalToolRuntime()
          : yield* input.localToolRuntimeLoader.load(
              runtimeLocalWorkspace.context,
            );
      const { catalog, toolInvoker } = createWorkspaceToolInvoker({
        workspaceId,
        accountId,
        controlPlaneStore: input.controlPlaneStore,
        sourceStore: input.sourceStore,
        sourceCatalogSyncService: input.sourceCatalogSyncService,
        sourceCatalogStore: input.sourceCatalogStore,
        installationStore: input.installationStore,
        workspaceConfigStore: input.workspaceConfigStore,
        workspaceStateStore: input.workspaceStateStore,
        sourceArtifactStore: input.sourceArtifactStore,
        sourceAuthMaterialService: input.sourceAuthMaterialService,
        sourceAuthService: input.sourceAuthService,
        runtimeLocalWorkspace,
        localToolRuntime,
        createInternalToolMap: input.createInternalToolMap,
        onElicitation,
      });

      const executor = createCodeExecutorForRuntime(
        resolveConfiguredExecutionRuntime(loadedConfig?.config),
      );

      return {
        executor,
        toolInvoker,
        catalog,
      } satisfies ExecutionEnvironment;
    });

export class RuntimeExecutionResolverService extends Context.Tag(
  "#runtime/RuntimeExecutionResolverService",
)<
  RuntimeExecutionResolverService,
  ReturnType<typeof createWorkspaceExecutionEnvironmentResolver>
>() {}

export const RuntimeExecutionResolverLive = (
  input: {
    executionResolver?: ResolveExecutionEnvironment;
    createInternalToolMap?: CreateWorkspaceInternalToolMap;
  } = {},
) =>
  input.executionResolver
    ? Layer.succeed(RuntimeExecutionResolverService, input.executionResolver)
    : Layer.effect(
        RuntimeExecutionResolverService,
        Effect.gen(function* () {
          const controlPlaneStore = yield* ControlPlaneStore;
          const sourceStore = yield* RuntimeSourceStoreService;
          const sourceCatalogSyncService =
            yield* RuntimeSourceCatalogSyncService;
          const sourceAuthMaterialService =
            yield* RuntimeSourceAuthMaterialService;
          const sourceAuthService = yield* RuntimeSourceAuthServiceTag;
          const sourceCatalogStore = yield* RuntimeSourceCatalogStoreService;
          const localToolRuntimeLoader = yield* LocalToolRuntimeLoaderService;
          const installationStore = yield* InstallationStore;
          const workspaceConfigStore = yield* WorkspaceConfigStore;
          const workspaceStateStore = yield* WorkspaceStateStore;
          const sourceArtifactStore = yield* SourceArtifactStore;

          return createWorkspaceExecutionEnvironmentResolver({
            controlPlaneStore,
            sourceStore,
            sourceCatalogSyncService,
            sourceAuthService,
            sourceAuthMaterialService,
            sourceCatalogStore,
            localToolRuntimeLoader,
            installationStore,
            workspaceConfigStore,
            workspaceStateStore,
            sourceArtifactStore,
            createInternalToolMap: input.createInternalToolMap,
          });
        }),
      );
