import * as Effect from "effect/Effect";

import type {
  ScopeId,
  Execution,
  ExecutionEnvelope,
  LocalInstallation,
  LocalScopePolicy,
  Source,
} from "./schema";
import type {
  CreateExecutionPayload,
  ResumeExecutionPayload,
} from "./executions/contracts";
import type {
  CreateSecretPayload,
  CreateSecretResult,
  DeleteSecretResult,
  InstanceConfig,
  SecretListItem,
  UpdateSecretPayload,
  UpdateSecretResult,
} from "./local/contracts";
import {
  getLocalInstallation,
} from "./local/operations";
import {
  createLocalSecret,
  deleteLocalSecret,
  getLocalInstanceConfig,
  listLocalSecrets,
  updateLocalSecret,
} from "./local/secrets";
import type {
  CreatePolicyPayload,
  UpdatePolicyPayload,
} from "./policies/contracts";
import {
  createPolicy,
  getPolicy,
  listPolicies,
  removePolicy,
  updatePolicy,
} from "./policies/operations";
import {
  discoverSourceInspectionTools,
  getSourceInspection,
  getSourceInspectionToolDetail,
} from "./sources/inspection";
import {
  createManagedSourceRecord,
  getSource,
  refreshManagedSourceCatalog,
  listSources,
  removeSource,
  saveManagedSourceRecord,
} from "./sources/operations";
import type { ExecutorBackend } from "./backend";
import {
  provideExecutorRuntime,
  type CreateScopeInternalToolMap,
  type ExecutorRuntime,
  type ExecutorRuntimeOptions,
  type ResolveExecutionEnvironment,
  type ResolveSecretMaterial,
} from "./runtime";
import {
  createExecution,
  getExecution,
  resumeExecution,
} from "./runtime/execution/service";
import type {
  ExecutorSdkPluginHost,
  ExecutorSdkPlugin,
  ExecutorSdkPluginExtensions,
} from "./plugins";
import {
  configureExecutorSourcePlugins,
} from "./runtime/sources/source-plugins";

type ProvidedEffect<T extends Effect.Effect<any, any, any>> = Effect.Effect<
  Effect.Effect.Success<T>,
  Effect.Effect.Error<T>,
  never
>;
type MappedProvidedEffect<
  T extends Effect.Effect<any, any, any>,
  A,
> = Effect.Effect<A, Effect.Effect.Error<T>, never>;

export type ExecutorEffect = {
  runtime: ExecutorRuntime;
  installation: LocalInstallation;
  scopeId: ScopeId;
  actorScopeId: ScopeId;
  resolutionScopeIds: ReadonlyArray<ScopeId>;
  close: () => Promise<void>;
  local: {
    installation: () => ProvidedEffect<ReturnType<typeof getLocalInstallation>>;
    config: () => ProvidedEffect<ReturnType<typeof getLocalInstanceConfig>>;
  };
  secrets: {
    list: () => ProvidedEffect<ReturnType<typeof listLocalSecrets>>;
    create: (
      payload: CreateSecretPayload,
    ) => ProvidedEffect<ReturnType<typeof createLocalSecret>>;
    update: (input: {
      secretId: string;
      payload: UpdateSecretPayload;
    }) => ProvidedEffect<ReturnType<typeof updateLocalSecret>>;
    remove: (
      secretId: string,
    ) => MappedProvidedEffect<
      ReturnType<typeof deleteLocalSecret>,
      DeleteSecretResult
    >;
  };
  policies: {
    list: () => ProvidedEffect<ReturnType<typeof listPolicies>>;
    create: (
      payload: CreatePolicyPayload,
    ) => ProvidedEffect<ReturnType<typeof createPolicy>>;
    get: (policyId: string) => ProvidedEffect<ReturnType<typeof getPolicy>>;
    update: (
      policyId: string,
      payload: UpdatePolicyPayload,
    ) => ProvidedEffect<ReturnType<typeof updatePolicy>>;
    remove: (
      policyId: string,
    ) => MappedProvidedEffect<ReturnType<typeof removePolicy>, boolean>;
  };
  sources: {
    list: () => ProvidedEffect<ReturnType<typeof listSources>>;
    get: (sourceId: Source["id"]) => ProvidedEffect<ReturnType<typeof getSource>>;
    remove: (
      sourceId: Source["id"],
    ) => MappedProvidedEffect<ReturnType<typeof removeSource>, boolean>;
    inspection: {
      get: (
        sourceId: Source["id"],
      ) => ProvidedEffect<ReturnType<typeof getSourceInspection>>;
      tool: (input: {
        sourceId: Source["id"];
        toolPath: string;
      }) => ProvidedEffect<ReturnType<typeof getSourceInspectionToolDetail>>;
      discover: (input: {
        sourceId: Source["id"];
        payload: Parameters<typeof discoverSourceInspectionTools>[0]["payload"];
      }) => ProvidedEffect<
        ReturnType<typeof discoverSourceInspectionTools>
      >;
    };
  };
  executions: {
    create: (
      payload: CreateExecutionPayload,
    ) => ProvidedEffect<ReturnType<typeof createExecution>>;
    get: (
      executionId: Execution["id"],
    ) => ProvidedEffect<ReturnType<typeof getExecution>>;
    resume: (
      executionId: Execution["id"],
      payload: ResumeExecutionPayload,
    ) => ProvidedEffect<ReturnType<typeof resumeExecution>>;
  };
};

export type CreateExecutorEffectOptions = ExecutorRuntimeOptions & {
  backend: ExecutorBackend;
};

type CreateExecutorEffectOptionsWithPlugins<
  TPlugins extends readonly ExecutorSdkPlugin<any, any>[],
> = CreateExecutorEffectOptions & {
  plugins?: TPlugins;
};

const fromRuntime = (runtime: ExecutorRuntime): ExecutorEffect => {
  const installation = runtime.localInstallation;
  const scopeId = installation.scopeId;
  const actorScopeId = installation.actorScopeId;
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    provideExecutorRuntime(effect, runtime);

  return {
    runtime,
    installation,
    scopeId,
    actorScopeId,
    resolutionScopeIds: installation.resolutionScopeIds,
    close: () => runtime.close(),
    local: {
      installation: () => provide(getLocalInstallation()),
      config: () => provide(getLocalInstanceConfig()),
    },
    secrets: {
      list: () => provide(listLocalSecrets()),
      create: (payload) => provide(createLocalSecret(payload)),
      update: (input) => provide(updateLocalSecret(input)),
      remove: (secretId) => provide(deleteLocalSecret(secretId)),
    },
    policies: {
      list: () => provide(listPolicies(scopeId)),
      create: (payload) => provide(createPolicy({ scopeId, payload })),
      get: (policyId) =>
        provide(getPolicy({ scopeId, policyId: policyId as never })),
      update: (policyId, payload) =>
        provide(updatePolicy({ scopeId, policyId: policyId as never, payload })),
      remove: (policyId) =>
        provide(removePolicy({ scopeId, policyId: policyId as never })).pipe(
          Effect.map((result) => result.removed),
        ),
    },
    sources: {
      list: () => provide(listSources({ scopeId, actorScopeId })),
      get: (sourceId) => provide(getSource({ scopeId, sourceId, actorScopeId })),
      remove: (sourceId) =>
        provide(removeSource({ scopeId, sourceId })).pipe(
          Effect.map((result) => result.removed),
        ),
      inspection: {
        get: (sourceId) => provide(getSourceInspection({ scopeId, sourceId })),
        tool: ({ sourceId, toolPath }) =>
          provide(
            getSourceInspectionToolDetail({
              scopeId,
              sourceId,
              toolPath,
            }),
          ),
        discover: ({ sourceId, payload }) =>
          provide(
            discoverSourceInspectionTools({
              scopeId,
              sourceId,
              payload,
            }),
          ),
      },
    },
    executions: {
      create: (payload) =>
        provide(
          createExecution({
            scopeId,
            payload,
            createdByScopeId: actorScopeId,
          }),
        ),
      get: (executionId) => provide(getExecution({ scopeId, executionId })),
      resume: (executionId, payload) =>
        provide(
          resumeExecution({
            scopeId,
            executionId,
            payload,
            resumedByScopeId: actorScopeId,
          }),
        ),
    },
  };
};

export const createExecutorEffect = <
  const TPlugins extends readonly ExecutorSdkPlugin<any, any>[] = [],
>(
  options: CreateExecutorEffectOptionsWithPlugins<TPlugins>,
): Effect.Effect<ExecutorEffect & ExecutorSdkPluginExtensions<TPlugins>, Error> => {
  configureExecutorSourcePlugins(options.plugins ?? []);

  return Effect.map(
    options.backend.createRuntime({
      executionResolver: options.executionResolver,
      createInternalToolMap: options.createInternalToolMap,
      resolveSecretMaterial: options.resolveSecretMaterial,
      getLocalServerBaseUrl: options.getLocalServerBaseUrl,
    }),
    (runtime) => {
      const executor = fromRuntime(runtime);
      const providePluginHostEffect = <A>(
        effect: Effect.Effect<A, unknown, any>,
      ): Effect.Effect<A, Error, never> =>
        provideExecutorRuntime(effect, runtime).pipe(
          Effect.mapError((cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          ),
        );
      const host: ExecutorSdkPluginHost = {
        sources: {
          create: ({ source }) =>
            providePluginHostEffect(
              createManagedSourceRecord({
                scopeId: executor.scopeId,
                actorScopeId: executor.actorScopeId,
                source,
              }),
            ),
          get: (sourceId) =>
            providePluginHostEffect(
              getSource({
                scopeId: executor.scopeId,
                sourceId,
                actorScopeId: executor.actorScopeId,
              }),
            ),
          save: (source) =>
            providePluginHostEffect(
              saveManagedSourceRecord({
                actorScopeId: executor.actorScopeId,
                source,
              }),
            ),
          refreshCatalog: (sourceId) =>
            providePluginHostEffect(
              refreshManagedSourceCatalog({
                scopeId: executor.scopeId,
                sourceId,
                actorScopeId: executor.actorScopeId,
              }),
            ),
          remove: (sourceId) =>
            providePluginHostEffect(
              removeSource({
                scopeId: executor.scopeId,
                sourceId,
              }).pipe(Effect.map((result) => result.removed)),
            ),
        },        
      };
      const extensions = Object.fromEntries(
        (options.plugins ?? []).map((plugin) => [
          plugin.key,
          plugin.extendExecutor?.({
            executor,
            host,
          }) ?? {},
        ]),
      );

      return Object.assign(
        executor,
        extensions,
      ) as ExecutorEffect & ExecutorSdkPluginExtensions<TPlugins>;
    },
  );
};
