import type { AccountId, WorkspaceId } from "#schema";
import * as Effect from "effect/Effect";

import type {
  LoadedLocalExecutorConfig,
  ResolvedLocalWorkspaceContext,
} from "../../local/local-config";
import {
  LocalExecutorConfigDecodeError,
  LocalFileSystemError,
  LocalWorkspaceStateDecodeError,
  RuntimeLocalWorkspaceMismatchError,
  RuntimeLocalWorkspaceUnavailableError,
} from "../../local/local-errors";
import {
  requireRuntimeLocalWorkspace,
  type RuntimeLocalWorkspaceState,
} from "../../local/local-runtime-context";
import type {
  SourceArtifactStoreShape,
  WorkspaceStorageServices,
  WorkspaceConfigStoreShape,
  WorkspaceStateStoreShape,
} from "../../local/local-storage";
import {
  SourceArtifactStore,
  WorkspaceConfigStore,
  WorkspaceStateStore,
} from "../../local/local-storage";
import type { LocalWorkspaceState } from "../../local/local-workspace-state";
import type { ControlPlaneStoreShape } from "../../store";

export type RuntimeSourceStoreDeps = {
  rows: ControlPlaneStoreShape;
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState;
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
};

export type ResolvedSourceStoreWorkspace = {
  context: ResolvedLocalWorkspaceContext;
  installation: {
    workspaceId: WorkspaceId;
    accountId: AccountId;
  };
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
  loadedConfig: LoadedLocalExecutorConfig;
  workspaceState: LocalWorkspaceState;
};

export const resolveRuntimeLocalWorkspaceFromDeps = (
  deps: RuntimeSourceStoreDeps,
  workspaceId: WorkspaceId,
): Effect.Effect<
  ResolvedSourceStoreWorkspace,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | Error,
  never
> =>
  Effect.gen(function* () {
    if (deps.runtimeLocalWorkspace.installation.workspaceId !== workspaceId) {
      return yield* Effect.fail(
        new RuntimeLocalWorkspaceMismatchError({
          message: `Runtime local workspace mismatch: expected ${workspaceId}, got ${deps.runtimeLocalWorkspace.installation.workspaceId}`,
          requestedWorkspaceId: workspaceId,
          activeWorkspaceId: deps.runtimeLocalWorkspace.installation.workspaceId,
        }),
      );
    }

    const loadedConfig = yield* deps.workspaceConfigStore.load(
      deps.runtimeLocalWorkspace.context,
    );
    const workspaceState = yield* deps.workspaceStateStore.load(
      deps.runtimeLocalWorkspace.context,
    );

    return {
      context: deps.runtimeLocalWorkspace.context,
      installation: deps.runtimeLocalWorkspace.installation,
      workspaceConfigStore: deps.workspaceConfigStore,
      workspaceStateStore: deps.workspaceStateStore,
      sourceArtifactStore: deps.sourceArtifactStore,
      loadedConfig,
      workspaceState,
    };
  });

export const loadRuntimeSourceStoreDeps = (
  rows: ControlPlaneStoreShape,
  workspaceId: WorkspaceId,
): Effect.Effect<
  RuntimeSourceStoreDeps,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | Error,
  WorkspaceStorageServices
> =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace(workspaceId);
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const sourceArtifactStore = yield* SourceArtifactStore;

    return {
      rows,
      runtimeLocalWorkspace,
      workspaceConfigStore,
      workspaceStateStore,
      sourceArtifactStore,
    };
  });
