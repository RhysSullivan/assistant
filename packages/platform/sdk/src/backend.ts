import * as Effect from "effect/Effect";

import {
  createControlPlaneRuntimeFromServices,
  type BoundInstallationStore,
  type BoundLocalToolRuntimeLoader,
  type BoundSourceArtifactStore,
  type BoundWorkspaceConfigStore,
  type BoundWorkspaceStateStore,
  type ControlPlaneRuntime,
  type RuntimeControlPlaneOptions,
  type RuntimeControlPlaneServices,
  type RuntimeSecretMaterialServices,
} from "./runtime";

export type ExecutorBackend = {
  createRuntime: (
    options: RuntimeControlPlaneOptions,
  ) => Effect.Effect<ControlPlaneRuntime, Error>;
};

export type ExecutorBackendServices = RuntimeControlPlaneServices;
export type ExecutorInstallationBackend = BoundInstallationStore;
export type ExecutorWorkspaceConfigBackend = BoundWorkspaceConfigStore;
export type ExecutorWorkspaceStateBackend = BoundWorkspaceStateStore;
export type ExecutorSourceArtifactBackend = BoundSourceArtifactStore;
export type ExecutorLocalToolBackend = BoundLocalToolRuntimeLoader;
export type ExecutorSecretMaterialBackend = RuntimeSecretMaterialServices;

export const createExecutorBackend = (input: {
  loadServices: (
    options: RuntimeControlPlaneOptions,
  ) => Effect.Effect<ExecutorBackendServices, Error>;
}): ExecutorBackend => ({
  createRuntime: (options) =>
    Effect.flatMap(input.loadServices(options), (services) =>
      createControlPlaneRuntimeFromServices({
        ...options,
        services,
      }),
    ),
});
