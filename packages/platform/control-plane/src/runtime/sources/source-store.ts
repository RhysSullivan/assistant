import type {
  AccountId,
  Source,
  WorkspaceId,
} from "#schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  SourceArtifactStore,
  type WorkspaceStorageServices,
  WorkspaceConfigStore,
  WorkspaceStateStore,
} from "../local/local-storage";
import { RuntimeLocalWorkspaceService } from "../local/local-runtime-context";
import { ControlPlaneStore, type ControlPlaneStoreShape } from "../store";
import {
  loadRuntimeSourceStoreDeps,
  type RuntimeSourceStoreDeps,
} from "./source-store/deps";
import {
  buildLocalSourceRecord,
  listLinkedSecretSourcesInWorkspaceWithDeps,
  loadSourceByIdWithDeps,
  loadSourcesInWorkspaceWithDeps,
} from "./source-store/records";
import {
  persistSourceWithDeps,
  removeSourceByIdWithDeps,
} from "./source-store/lifecycle";

export { buildLocalSourceRecord } from "./source-store/records";

type RuntimeSourceStoreShape = {
  loadSourcesInWorkspace: (
    workspaceId: WorkspaceId,
    options?: { actorAccountId?: AccountId | null },
  ) => ReturnType<typeof loadSourcesInWorkspaceWithDeps>;
  listLinkedSecretSourcesInWorkspace: (
    workspaceId: WorkspaceId,
    options?: { actorAccountId?: AccountId | null },
  ) => ReturnType<typeof listLinkedSecretSourcesInWorkspaceWithDeps>;
  loadSourceById: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
    actorAccountId?: AccountId | null;
  }) => ReturnType<typeof loadSourceByIdWithDeps>;
  removeSourceById: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
  }) => ReturnType<typeof removeSourceByIdWithDeps>;
  persistSource: (
    source: Source,
    options?: { actorAccountId?: AccountId | null },
  ) => ReturnType<typeof persistSourceWithDeps>;
};

export type RuntimeSourceStore = RuntimeSourceStoreShape;

export const loadSourcesInWorkspace = (
  rows: ControlPlaneStoreShape,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<readonly Source[], Error, WorkspaceStorageServices> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, workspaceId),
    (deps) => loadSourcesInWorkspaceWithDeps(deps, workspaceId, options),
  );

export const listLinkedSecretSourcesInWorkspace = (
  rows: ControlPlaneStoreShape,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<
  Map<string, Array<{ sourceId: string; sourceName: string }>>,
  Error,
  WorkspaceStorageServices
> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, workspaceId),
    (deps) => listLinkedSecretSourcesInWorkspaceWithDeps(deps, workspaceId, options),
  );

export const loadSourceById = (
  rows: ControlPlaneStoreShape,
  input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
    actorAccountId?: AccountId | null;
  },
): Effect.Effect<Source, Error, WorkspaceStorageServices> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, input.workspaceId),
    (deps) => loadSourceByIdWithDeps(deps, input),
  );

export const removeSourceById = (
  rows: ControlPlaneStoreShape,
  input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
  },
): Effect.Effect<boolean, Error, WorkspaceStorageServices> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, input.workspaceId),
    (deps) => removeSourceByIdWithDeps(deps, input),
  );

export const persistSource = (
  rows: ControlPlaneStoreShape,
  source: Source,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<Source, Error, WorkspaceStorageServices> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, source.workspaceId),
    (deps) => persistSourceWithDeps(deps, source, options),
  );

export class RuntimeSourceStoreService extends Context.Tag(
  "#runtime/RuntimeSourceStoreService",
)<RuntimeSourceStoreService, RuntimeSourceStoreShape>() {}

export const RuntimeSourceStoreLive = Layer.effect(
  RuntimeSourceStoreService,
  Effect.gen(function* () {
    const rows = yield* ControlPlaneStore;
    const runtimeLocalWorkspace = yield* RuntimeLocalWorkspaceService;
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const sourceArtifactStore = yield* SourceArtifactStore;

    const deps: RuntimeSourceStoreDeps = {
      rows,
      runtimeLocalWorkspace,
      workspaceConfigStore,
      workspaceStateStore,
      sourceArtifactStore,
    };

    return RuntimeSourceStoreService.of({
      loadSourcesInWorkspace: (workspaceId, options = {}) =>
        loadSourcesInWorkspaceWithDeps(deps, workspaceId, options),
      listLinkedSecretSourcesInWorkspace: (workspaceId, options = {}) =>
        listLinkedSecretSourcesInWorkspaceWithDeps(deps, workspaceId, options),
      loadSourceById: (input) =>
        loadSourceByIdWithDeps(deps, input),
      removeSourceById: (input) =>
        removeSourceByIdWithDeps(deps, input),
      persistSource: (source, options = {}) =>
        persistSourceWithDeps(deps, source, options),
    });
  }),
);
