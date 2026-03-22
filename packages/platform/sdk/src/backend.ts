import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  createExecutorRuntimeFromServices,
  type BoundInstallationStore,
  type BoundLocalToolRuntimeLoader,
  type BoundSourceArtifactStore,
  type BoundSourceTypeDeclarationsRefresher,
  type BoundScopeConfigStore,
  type BoundScopeStateStore,
  type ExecutorRuntime,
  type ExecutorRuntimeOptions,
  type RuntimeAuthStorageServices,
  type RuntimeExecutionStorageServices,
  type RuntimeInstanceConfigService,
  type RuntimeSecretsStorageServices,
  type RuntimeStorageServices,
} from "./runtime";
import type {
  ExecutorScopeContext,
  ExecutorScopeDescriptor,
} from "./scope";
export type {
  ExecutorScopeContext,
  ExecutorScopeDescriptor,
} from "./scope";

export type ExecutorBackend = {
  createRuntime: (
    options: ExecutorRuntimeOptions,
  ) => Effect.Effect<ExecutorRuntime, Error>;
};

type MaybeEffect<T> = T | Promise<T> | Effect.Effect<T, Error, never>;
type OptionalValue<T> = T | null | Option.Option<T>;
type PublicizeMethod<F> = F extends (...args: infer Args) => Effect.Effect<infer Value, any, any>
  ? [Value] extends [Option.Option<infer Inner>]
    ? (...args: Args) => MaybeEffect<OptionalValue<Inner>>
    : (...args: Args) => MaybeEffect<Value>
  : F;
type PublicizeObject<T> = {
  [Key in keyof T]: T[Key] extends (...args: any[]) => any
    ? PublicizeMethod<T[Key]>
    : T[Key] extends object
      ? PublicizeObject<T[Key]>
      : T[Key];
};

export type ExecutorInstallationBackend = PublicizeObject<BoundInstallationStore>;
export type ExecutorScopeConfigBackend = PublicizeObject<BoundScopeConfigStore>;
export type ExecutorScopeStateBackend = PublicizeObject<BoundScopeStateStore>;
export type ExecutorSourceArtifactBackend = PublicizeObject<BoundSourceArtifactStore>;
export type ExecutorLocalToolBackend = PublicizeObject<BoundLocalToolRuntimeLoader>;
export type ExecutorSourceTypeDeclarationsBackend = PublicizeObject<
  BoundSourceTypeDeclarationsRefresher
>;
export type ExecutorAuthBackend = {
  artifacts: PublicizeObject<RuntimeAuthStorageServices["artifacts"]>;
  leases: PublicizeObject<RuntimeAuthStorageServices["leases"]>;
  sourceOauthClients: PublicizeObject<RuntimeAuthStorageServices["sourceOauthClients"]>;
  scopeOauthClients: PublicizeObject<RuntimeAuthStorageServices["scopeOauthClients"]>;
  providerGrants: PublicizeObject<RuntimeAuthStorageServices["providerGrants"]>;
  sourceSessions: PublicizeObject<RuntimeAuthStorageServices["sourceSessions"]>;
};
export type ExecutorSecretsBackend = PublicizeObject<RuntimeSecretsStorageServices>;
export type ExecutorExecutionsBackend = {
  runs: PublicizeObject<RuntimeExecutionStorageServices["runs"]>;
  interactions: PublicizeObject<RuntimeExecutionStorageServices["interactions"]>;
  steps: PublicizeObject<RuntimeExecutionStorageServices["steps"]>;
};
export type ExecutorInstanceConfigBackend = PublicizeObject<RuntimeInstanceConfigService>;

export type ExecutorStorageBackend = {
  installation: ExecutorInstallationBackend;
  scopeConfig: ExecutorScopeConfigBackend;
  scopeState: ExecutorScopeStateBackend;
  sourceArtifacts: ExecutorSourceArtifactBackend;
  auth: ExecutorAuthBackend;
  secrets: ExecutorSecretsBackend;
  executions: ExecutorExecutionsBackend;
  close?: () => Promise<void>;
};

export type ExecutorBackendServices = {
  scope: ExecutorScopeDescriptor;
  storage: ExecutorStorageBackend;
  instanceConfig: ExecutorInstanceConfigBackend;
  localTools?: ExecutorLocalToolBackend;
  sourceTypeDeclarations?: ExecutorSourceTypeDeclarationsBackend;
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const toEffect = <T>(value: MaybeEffect<T>): Effect.Effect<T, Error, never> => {
  if (Effect.isEffect(value)) {
    return value;
  }

  if (value instanceof Promise) {
    return Effect.tryPromise({
      try: () => value,
      catch: toError,
    });
  }

  return Effect.succeed(value);
};

const toOptionEffect = <T>(
  value: MaybeEffect<OptionalValue<T>>,
): Effect.Effect<Option.Option<T>, Error, never> =>
  toEffect(value).pipe(
    Effect.map((result) =>
      Option.isOption(result) ? result : Option.fromNullable(result),
    ),
  );

const toInstallationBackend = (
  input: ExecutorInstallationBackend,
): BoundInstallationStore => ({
  load: () => toEffect(input.load()),
  getOrProvision: () => toEffect(input.getOrProvision()),
});

const toScopeConfigBackend = (
  input: ExecutorScopeConfigBackend,
): BoundScopeConfigStore => ({
  load: () => toEffect(input.load()),
  writeProject: (config) => toEffect(input.writeProject(config)),
  resolveRelativePath: input.resolveRelativePath,
});

const toScopeStateBackend = (
  input: ExecutorScopeStateBackend,
): BoundScopeStateStore => ({
  load: () => toEffect(input.load()),
  write: (state) => toEffect(input.write(state)),
});

const toSourceArtifactBackend = (
  input: ExecutorSourceArtifactBackend,
): BoundSourceArtifactStore => ({
  build: input.build,
  read: (sourceId) => toEffect(input.read(sourceId)),
  write: (payload) => toEffect(input.write(payload)),
  remove: (sourceId) => toEffect(input.remove(sourceId)),
});

const toInstanceConfigBackend = (
  input: ExecutorInstanceConfigBackend,
): RuntimeInstanceConfigService => ({
  resolve: () => toEffect(input.resolve()),
});

const toLocalToolBackend = (
  input: ExecutorLocalToolBackend,
): BoundLocalToolRuntimeLoader => ({
  load: () => toEffect(input.load()),
});

const toSourceTypeDeclarationsBackend = (
  input: ExecutorSourceTypeDeclarationsBackend,
): BoundSourceTypeDeclarationsRefresher => ({
  refreshWorkspaceInBackground: (payload) =>
    toEffect(input.refreshWorkspaceInBackground(payload)).pipe(Effect.orDie),
  refreshSourceInBackground: (payload) =>
    toEffect(input.refreshSourceInBackground(payload)).pipe(Effect.orDie),
});

const toAuthBackend = (
  input: ExecutorAuthBackend,
): RuntimeAuthStorageServices => ({
  artifacts: {
    listByScopeId: (scopeId) => toEffect(input.artifacts.listByScopeId(scopeId)),
    listByScopeAndSourceId: (payload) =>
      toEffect(input.artifacts.listByScopeAndSourceId(payload)),
    getByScopeSourceAndActor: (payload) =>
      toOptionEffect(input.artifacts.getByScopeSourceAndActor(payload)),
    upsert: (artifact) => toEffect(input.artifacts.upsert(artifact)),
    removeByScopeSourceAndActor: (payload) =>
      toEffect(input.artifacts.removeByScopeSourceAndActor(payload)),
    removeByScopeAndSourceId: (payload) =>
      toEffect(input.artifacts.removeByScopeAndSourceId(payload)),
  },
  leases: {
    listAll: () => toEffect(input.leases.listAll()),
    getByAuthArtifactId: (authArtifactId) =>
      toOptionEffect(input.leases.getByAuthArtifactId(authArtifactId)),
    upsert: (lease) => toEffect(input.leases.upsert(lease)),
    removeByAuthArtifactId: (authArtifactId) =>
      toEffect(input.leases.removeByAuthArtifactId(authArtifactId)),
  },
  sourceOauthClients: {
    getByScopeSourceAndProvider: (payload) =>
      toOptionEffect(input.sourceOauthClients.getByScopeSourceAndProvider(payload)),
    upsert: (oauthClient) => toEffect(input.sourceOauthClients.upsert(oauthClient)),
    removeByScopeAndSourceId: (payload) =>
      toEffect(input.sourceOauthClients.removeByScopeAndSourceId(payload)),
  },
  scopeOauthClients: {
    listByScopeAndProvider: (payload) =>
      toEffect(input.scopeOauthClients.listByScopeAndProvider(payload)),
    getById: (id) => toOptionEffect(input.scopeOauthClients.getById(id)),
    upsert: (oauthClient) => toEffect(input.scopeOauthClients.upsert(oauthClient)),
    removeById: (id) => toEffect(input.scopeOauthClients.removeById(id)),
  },
  providerGrants: {
    listByScopeId: (scopeId) => toEffect(input.providerGrants.listByScopeId(scopeId)),
    listByScopeActorAndProvider: (payload) =>
      toEffect(input.providerGrants.listByScopeActorAndProvider(payload)),
    getById: (id) => toOptionEffect(input.providerGrants.getById(id)),
    upsert: (grant) => toEffect(input.providerGrants.upsert(grant)),
    removeById: (id) => toEffect(input.providerGrants.removeById(id)),
  },
  sourceSessions: {
    listAll: () => toEffect(input.sourceSessions.listAll()),
    listByScopeId: (scopeId) => toEffect(input.sourceSessions.listByScopeId(scopeId)),
    getById: (id) => toOptionEffect(input.sourceSessions.getById(id)),
    getByState: (state) => toOptionEffect(input.sourceSessions.getByState(state)),
    getPendingByScopeSourceAndActor: (payload) =>
      toOptionEffect(input.sourceSessions.getPendingByScopeSourceAndActor(payload)),
    insert: (session) => toEffect(input.sourceSessions.insert(session)),
    update: (id, patch) => toOptionEffect(input.sourceSessions.update(id, patch)),
    upsert: (session) => toEffect(input.sourceSessions.upsert(session)),
    removeByScopeAndSourceId: (scopeId, sourceId) =>
      toEffect(input.sourceSessions.removeByScopeAndSourceId(scopeId, sourceId)),
  },
});

const toSecretsBackend = (
  input: ExecutorSecretsBackend,
): RuntimeSecretsStorageServices => ({
  getById: (id) => toOptionEffect(input.getById(id)),
  listAll: () => toEffect(input.listAll()),
  upsert: (material) => toEffect(input.upsert(material)),
  updateById: (id, patch) => toOptionEffect(input.updateById(id, patch)),
  removeById: (id) => toEffect(input.removeById(id)),
  resolve: (payload) => toEffect(input.resolve(payload)),
  store: (payload) => toEffect(input.store(payload)),
  delete: (payload) => toEffect(input.delete(payload)),
  update: (payload) => toEffect(input.update(payload)),
});

const toExecutionsBackend = (
  input: ExecutorExecutionsBackend,
): RuntimeExecutionStorageServices => ({
  runs: {
    getById: (executionId) => toOptionEffect(input.runs.getById(executionId)),
    getByScopeAndId: (scopeId, executionId) =>
      toOptionEffect(input.runs.getByScopeAndId(scopeId, executionId)),
    insert: (execution) => toEffect(input.runs.insert(execution)),
    update: (executionId, patch) =>
      toOptionEffect(input.runs.update(executionId, patch)),
  },
  interactions: {
    getById: (interactionId) =>
      toOptionEffect(input.interactions.getById(interactionId)),
    listByExecutionId: (executionId) =>
      toEffect(input.interactions.listByExecutionId(executionId)),
    getPendingByExecutionId: (executionId) =>
      toOptionEffect(input.interactions.getPendingByExecutionId(executionId)),
    insert: (interaction) => toEffect(input.interactions.insert(interaction)),
    update: (interactionId, patch) =>
      toOptionEffect(input.interactions.update(interactionId, patch)),
  },
  steps: {
    getByExecutionAndSequence: (executionId, sequence) =>
      toOptionEffect(input.steps.getByExecutionAndSequence(executionId, sequence)),
    listByExecutionId: (executionId) =>
      toEffect(input.steps.listByExecutionId(executionId)),
    insert: (step) => toEffect(input.steps.insert(step)),
    deleteByExecutionId: (executionId) =>
      toEffect(input.steps.deleteByExecutionId(executionId)),
    updateByExecutionAndSequence: (executionId, sequence, patch) =>
      toOptionEffect(
        input.steps.updateByExecutionAndSequence(
          executionId,
          sequence,
          patch,
        ),
      ),
  },
});

export const createExecutorBackend = (input: {
  loadServices: (
    options: ExecutorRuntimeOptions,
  ) => MaybeEffect<ExecutorBackendServices>;
}): ExecutorBackend => ({
  createRuntime: (options) =>
    Effect.flatMap(toEffect(input.loadServices(options)), (services) =>
      createExecutorRuntimeFromServices({
        ...options,
        services: {
          scope: services.scope,
          storage: {
            installation: toInstallationBackend(services.storage.installation),
            scopeConfig: toScopeConfigBackend(services.storage.scopeConfig),
            scopeState: toScopeStateBackend(services.storage.scopeState),
            sourceArtifacts: toSourceArtifactBackend(services.storage.sourceArtifacts),
            auth: toAuthBackend(services.storage.auth),
            secrets: toSecretsBackend(services.storage.secrets),
            executions: toExecutionsBackend(services.storage.executions),
            close: services.storage.close,
          } satisfies RuntimeStorageServices,
          localToolRuntimeLoader: services.localTools
            ? toLocalToolBackend(services.localTools)
            : undefined,
          sourceTypeDeclarationsRefresher: services.sourceTypeDeclarations
            ? toSourceTypeDeclarationsBackend(services.sourceTypeDeclarations)
            : undefined,
          instanceConfig: toInstanceConfigBackend(services.instanceConfig),
        },
      }),
    ),
});
