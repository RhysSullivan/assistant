import type {
  LocalInstallation,
  ExecutorScopeConfig,
} from "#schema";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import type {
  LoadedExecutorScopeConfig,
} from "../scope-config";
import type {
  LocalSourceArtifact,
} from "../source-artifacts";
import type {
  LocalScopeState,
} from "../scope-state";
import type {
  SourceCatalogSyncResult,
} from "@executor/source-core";
import type {
  Source,
} from "#schema";

export type InstallationStoreShape = {
  load: () => import("effect/Effect").Effect<LocalInstallation, Error, never>;
  getOrProvision: () => import("effect/Effect").Effect<LocalInstallation, Error, never>;
};

export class InstallationStore extends Context.Tag(
  "#runtime/InstallationStore",
)<InstallationStore, InstallationStoreShape>() {}

export type ScopeConfigStoreShape = {
  load: () => import("effect/Effect").Effect<LoadedExecutorScopeConfig, Error, never>;
  writeProject: (input: {
    config: ExecutorScopeConfig;
  }) => import("effect/Effect").Effect<void, Error, never>;
  resolveRelativePath: (input: { path: string; scopeRoot: string }) => string;
};

export class ScopeConfigStore extends Context.Tag(
  "#runtime/ScopeConfigStore",
)<ScopeConfigStore, ScopeConfigStoreShape>() {}

export type ScopeStateStoreShape = {
  load: () => import("effect/Effect").Effect<LocalScopeState, Error, never>;
  write: (input: {
    state: LocalScopeState;
  }) => import("effect/Effect").Effect<void, Error, never>;
};

export class ScopeStateStore extends Context.Tag(
  "#runtime/ScopeStateStore",
)<ScopeStateStore, ScopeStateStoreShape>() {}

export type SourceArtifactStoreShape = {
  build: (input: {
    source: Source;
    syncResult: SourceCatalogSyncResult;
  }) => LocalSourceArtifact;
  read: (input: {
    sourceId: string;
  }) => import("effect/Effect").Effect<LocalSourceArtifact | null, Error, never>;
  write: (input: {
    sourceId: string;
    artifact: LocalSourceArtifact;
  }) => import("effect/Effect").Effect<void, Error, never>;
  remove: (input: {
    sourceId: string;
  }) => import("effect/Effect").Effect<void, Error, never>;
};

export class SourceArtifactStore extends Context.Tag(
  "#runtime/SourceArtifactStore",
)<SourceArtifactStore, SourceArtifactStoreShape>() {}

export type LocalStorageServices =
  | InstallationStore
  | ScopeConfigStore
  | ScopeStateStore
  | SourceArtifactStore;

export type ScopeStorageServices =
  | ScopeConfigStore
  | ScopeStateStore
  | SourceArtifactStore;

export const makeScopeStorageLayer = (input: {
  scopeConfigStore: ScopeConfigStoreShape;
  scopeStateStore: ScopeStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
}) =>
  Layer.mergeAll(
    Layer.succeed(ScopeConfigStore, input.scopeConfigStore),
    Layer.succeed(ScopeStateStore, input.scopeStateStore),
    Layer.succeed(SourceArtifactStore, input.sourceArtifactStore),
  );

export const makeLocalStorageLayer = (input: {
  installationStore: InstallationStoreShape;
  scopeConfigStore: ScopeConfigStoreShape;
  scopeStateStore: ScopeStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
}) =>
  Layer.mergeAll(
    Layer.succeed(InstallationStore, input.installationStore),
    makeScopeStorageLayer(input),
  );
