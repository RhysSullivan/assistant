import * as Effect from "effect/Effect";

import type {
  ScopeId,
  Execution,
  ExecutionEnvelope,
  ExecutionInteraction,
  LocalInstallation,
  LocalScopePolicy,
  ProviderAuthGrant,
  Source,
  ScopeOauthClient,
} from "./schema";
import {
  ExecutionIdSchema,
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
  completeSourceCredentialSetup,
  getLocalInstallation,
  getSourceCredentialInteraction,
  submitSourceCredentialInteraction,
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
import type {
  CreateSourcePayload,
  CreateScopeOauthClientPayload,
  UpdateSourcePayload,
} from "./sources/contracts";
import {
  discoverSource,
} from "./sources/discovery";
import {
  discoverSourceInspectionTools,
  getSourceInspection,
  getSourceInspectionToolDetail,
} from "./sources/inspection";
import {
  createSource,
  getSource,
  listSources,
  removeSource,
  updateSource,
} from "./sources/operations";
import type {
  ExecutorBackend,
} from "./backend";
import {
  provideExecutorRuntime,
  type ExecutorRuntime,
  type ExecutorRuntimeOptions,
  type CreateScopeInternalToolMap,
  type ResolveExecutionEnvironment,
  type ResolveSecretMaterial,
  RuntimeSourceAuthServiceTag,
} from "./runtime";
import {
  createExecution,
  getExecution,
  resumeExecution,
} from "./runtime/execution/service";
import type {
  CompleteProviderOauthCallbackResult,
  CompleteSourceCredentialSetupResult,
  CompleteSourceOAuthSessionResult,
  ConnectGoogleDiscoveryBatchInput,
  ConnectGoogleDiscoveryBatchResult,
  ConnectMcpSourceInput,
  ExecutorAddSourceInput,
  ExecutorSourceAddResult,
  McpSourceConnectResult,
  StartSourceOAuthSessionInput,
  StartSourceOAuthSessionResult,
} from "./runtime/sources/source-auth-service";

type DistributiveOmit<T, Keys extends PropertyKey> = T extends unknown ? Omit<T, Keys> : never;
type ProvidedEffect<T extends Effect.Effect<any, any, any>> = Effect.Effect<
  Effect.Effect.Success<T>,
  Effect.Effect.Error<T>,
  never
>;

export type ExecutorSourceInput = DistributiveOmit<
  ExecutorAddSourceInput,
  "scopeId" | "actorScopeId" | "executionId" | "interactionId"
>;

export type ExecutorSourceBatchInput = DistributiveOmit<
  ConnectGoogleDiscoveryBatchInput,
  "scopeId" | "actorScopeId" | "executionId" | "interactionId"
>;

export type ExecutorMcpSourceInput = DistributiveOmit<
  ConnectMcpSourceInput,
  "scopeId" | "actorScopeId"
>;

export type ExecutorSourceOAuthInput = DistributiveOmit<
  StartSourceOAuthSessionInput,
  "scopeId" | "actorScopeId"
>;

export type Executor = {
  runtime: ExecutorRuntime;
  installation: LocalInstallation;
  scopeId: ScopeId;
  actorScopeId: ScopeId;
  resolutionScopeIds: ReadonlyArray<ScopeId>;
  provide: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, any>;
  run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  close: () => Promise<void>;
  effect: {
    local: {
      installation: () => ProvidedEffect<ReturnType<typeof getLocalInstallation>>;
      config: () => ProvidedEffect<ReturnType<typeof getLocalInstanceConfig>>;
      credentials: {
        get: (input: {
          sourceId: Source["id"];
          interactionId: ExecutionInteraction["id"];
        }) => ProvidedEffect<ReturnType<typeof getSourceCredentialInteraction>>;
        submit: (input: {
          sourceId: Source["id"];
          interactionId: ExecutionInteraction["id"];
          action: "submit" | "continue" | "cancel";
          token?: string | null;
        }) => ProvidedEffect<ReturnType<typeof submitSourceCredentialInteraction>>;
        complete: (input: {
          sourceId: Source["id"];
          state: string;
          code?: string | null;
          error?: string | null;
          errorDescription?: string | null;
        }) => ProvidedEffect<ReturnType<typeof completeSourceCredentialSetup>>;
      };
    };
    secrets: {
      list: () => ProvidedEffect<ReturnType<typeof listLocalSecrets>>;
      create: (payload: CreateSecretPayload) => ProvidedEffect<ReturnType<typeof createLocalSecret>>;
      update: (input: {
        secretId: string;
        payload: UpdateSecretPayload;
      }) => ProvidedEffect<ReturnType<typeof updateLocalSecret>>;
      remove: (secretId: string) => ProvidedEffect<ReturnType<typeof deleteLocalSecret>>;
    };
    policies: {
      list: () => ProvidedEffect<ReturnType<typeof listPolicies>>;
      create: (payload: CreatePolicyPayload) => ProvidedEffect<ReturnType<typeof createPolicy>>;
      get: (policyId: string) => ProvidedEffect<ReturnType<typeof getPolicy>>;
      update: (
        policyId: string,
        payload: UpdatePolicyPayload,
      ) => ProvidedEffect<ReturnType<typeof updatePolicy>>;
      remove: (policyId: string) => ProvidedEffect<ReturnType<typeof removePolicy>>;
    };
    sources: {
      add: (
        input: ExecutorSourceInput,
        options?: {
          baseUrl?: string | null;
        },
      ) => Effect.Effect<ExecutorSourceAddResult, Error, never>;
      connect: (payload: ExecutorMcpSourceInput) => Effect.Effect<McpSourceConnectResult, Error, never>;
      connectBatch: (
        payload: ExecutorSourceBatchInput,
      ) => Effect.Effect<ConnectGoogleDiscoveryBatchResult, Error, never>;
      discover: (input: {
        url: string;
        probeAuth?: Parameters<typeof discoverSource>[0]["probeAuth"];
      }) => ProvidedEffect<ReturnType<typeof discoverSource>>;
      list: () => ProvidedEffect<ReturnType<typeof listSources>>;
      create: (payload: CreateSourcePayload) => ProvidedEffect<ReturnType<typeof createSource>>;
      get: (sourceId: Source["id"]) => ProvidedEffect<ReturnType<typeof getSource>>;
      update: (
        sourceId: Source["id"],
        payload: UpdateSourcePayload,
      ) => ProvidedEffect<ReturnType<typeof updateSource>>;
      remove: (sourceId: Source["id"]) => ProvidedEffect<ReturnType<typeof removeSource>>;
      inspection: {
        get: (sourceId: Source["id"]) => ProvidedEffect<ReturnType<typeof getSourceInspection>>;
        tool: (input: {
          sourceId: Source["id"];
          toolPath: string;
        }) => ProvidedEffect<ReturnType<typeof getSourceInspectionToolDetail>>;
        discover: (input: {
          sourceId: Source["id"];
          payload: Parameters<typeof discoverSourceInspectionTools>[0]["payload"];
        }) => ProvidedEffect<ReturnType<typeof discoverSourceInspectionTools>>;
      };
      oauthClients: {
        list: (
          providerKey: string,
        ) => Effect.Effect<ReadonlyArray<ScopeOauthClient>, Error, never>;
        create: (
          payload: CreateScopeOauthClientPayload,
        ) => Effect.Effect<ScopeOauthClient, Error, never>;
        remove: (
          oauthClientId: ScopeOauthClient["id"],
        ) => Effect.Effect<boolean, Error, never>;
      };
      providerGrants: {
        remove: (grantId: ProviderAuthGrant["id"]) => Effect.Effect<boolean, Error, never>;
      };
    };
    oauth: {
      startSourceAuth: (
        input: ExecutorSourceOAuthInput,
      ) => Effect.Effect<StartSourceOAuthSessionResult, Error, never>;
      completeSourceAuth: (input: {
        state: string;
        code?: string | null;
        error?: string | null;
        errorDescription?: string | null;
      }) => Effect.Effect<CompleteSourceOAuthSessionResult, Error, never>;
      completeProviderCallback: (input: {
        scopeId?: ScopeId;
        actorScopeId?: ScopeId | null;
        state: string;
        code?: string | null;
        error?: string | null;
        errorDescription?: string | null;
      }) => Effect.Effect<CompleteProviderOauthCallbackResult, Error, never>;
    };
    executions: {
      create: (payload: CreateExecutionPayload) => ProvidedEffect<ReturnType<typeof createExecution>>;
      get: (executionId: Execution["id"]) => ProvidedEffect<ReturnType<typeof getExecution>>;
      resume: (
        executionId: Execution["id"],
        payload: ResumeExecutionPayload,
      ) => ProvidedEffect<ReturnType<typeof resumeExecution>>;
    };
  };
  local: {
    installation: () => Promise<LocalInstallation>;
    config: () => Promise<InstanceConfig>;
    credentials: {
      get: (input: {
        sourceId: Source["id"];
        interactionId: ExecutionInteraction["id"];
      }) => Promise<Effect.Effect.Success<ReturnType<typeof getSourceCredentialInteraction>>>;
      submit: (input: {
        sourceId: Source["id"];
        interactionId: ExecutionInteraction["id"];
        action: "submit" | "continue" | "cancel";
        token?: string | null;
      }) => Promise<Effect.Effect.Success<ReturnType<typeof submitSourceCredentialInteraction>>>;
      complete: (input: {
        sourceId: Source["id"];
        state: string;
        code?: string | null;
        error?: string | null;
        errorDescription?: string | null;
      }) => Promise<CompleteSourceCredentialSetupResult>;
    };
  };
  secrets: {
    list: () => Promise<ReadonlyArray<SecretListItem>>;
    create: (payload: CreateSecretPayload) => Promise<CreateSecretResult>;
    update: (input: {
      secretId: string;
      payload: UpdateSecretPayload;
    }) => Promise<UpdateSecretResult>;
    remove: (secretId: string) => Promise<DeleteSecretResult>;
  };
  policies: {
    list: () => Promise<ReadonlyArray<LocalScopePolicy>>;
    create: (payload: CreatePolicyPayload) => Promise<LocalScopePolicy>;
    get: (policyId: string) => Promise<LocalScopePolicy>;
    update: (
      policyId: string,
      payload: UpdatePolicyPayload,
    ) => Promise<LocalScopePolicy>;
    remove: (policyId: string) => Promise<boolean>;
  };
  sources: {
    add: (
      input: ExecutorSourceInput,
      options?: {
        baseUrl?: string | null;
      },
    ) => Promise<ExecutorSourceAddResult>;
    connect: (payload: ExecutorMcpSourceInput) => Promise<McpSourceConnectResult>;
    connectBatch: (payload: ExecutorSourceBatchInput) => Promise<ConnectGoogleDiscoveryBatchResult>;
    discover: (input: {
      url: string;
      probeAuth?: Parameters<typeof discoverSource>[0]["probeAuth"];
    }) => Promise<Effect.Effect.Success<ReturnType<typeof discoverSource>>>;
    list: () => Promise<ReadonlyArray<Source>>;
    create: (payload: CreateSourcePayload) => Promise<Source>;
    get: (sourceId: Source["id"]) => Promise<Source>;
    update: (sourceId: Source["id"], payload: UpdateSourcePayload) => Promise<Source>;
    remove: (sourceId: Source["id"]) => Promise<boolean>;
    inspection: {
      get: (sourceId: Source["id"]) => Promise<Effect.Effect.Success<ReturnType<typeof getSourceInspection>>>;
      tool: (input: {
        sourceId: Source["id"];
        toolPath: string;
      }) => Promise<Effect.Effect.Success<ReturnType<typeof getSourceInspectionToolDetail>>>;
      discover: (input: {
        sourceId: Source["id"];
        payload: Parameters<typeof discoverSourceInspectionTools>[0]["payload"];
      }) => Promise<Effect.Effect.Success<ReturnType<typeof discoverSourceInspectionTools>>>;
    };
    oauthClients: {
      list: (providerKey: string) => Promise<ReadonlyArray<ScopeOauthClient>>;
      create: (
        payload: CreateScopeOauthClientPayload,
      ) => Promise<ScopeOauthClient>;
      remove: (oauthClientId: ScopeOauthClient["id"]) => Promise<boolean>;
    };
    providerGrants: {
      remove: (grantId: ProviderAuthGrant["id"]) => Promise<boolean>;
    };
  };
  oauth: {
    startSourceAuth: (input: ExecutorSourceOAuthInput) => Promise<StartSourceOAuthSessionResult>;
    completeSourceAuth: (input: {
      state: string;
      code?: string | null;
      error?: string | null;
      errorDescription?: string | null;
    }) => Promise<CompleteSourceOAuthSessionResult>;
    completeProviderCallback: (input: {
      scopeId?: ScopeId;
      actorScopeId?: ScopeId | null;
      state: string;
      code?: string | null;
      error?: string | null;
      errorDescription?: string | null;
    }) => Promise<CompleteProviderOauthCallbackResult>;
  };
  executions: {
    create: (payload: CreateExecutionPayload) => Promise<ExecutionEnvelope>;
    get: (executionId: Execution["id"]) => Promise<ExecutionEnvelope>;
    resume: (
      executionId: Execution["id"],
      payload: ResumeExecutionPayload,
    ) => Promise<ExecutionEnvelope>;
  };
};

export type CreateExecutorOptions = ExecutorRuntimeOptions & {
  backend: ExecutorBackend;
};

const fromRuntime = (runtime: ExecutorRuntime): Executor => {
  const installation = runtime.localInstallation;
  const scopeId = installation.scopeId;
  const actorScopeId = installation.actorScopeId;
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    provideExecutorRuntime(effect, runtime);
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(provide(effect) as Effect.Effect<A, E, never>);
  const provideSourceAuth = <A, E>(
    execute: (
      service: Effect.Effect.Success<typeof RuntimeSourceAuthServiceTag>,
    ) => Effect.Effect<A, E, any>,
  ) => provide(Effect.flatMap(RuntimeSourceAuthServiceTag, execute));
  const createSdkSourceSession = () => {
    const id = crypto.randomUUID();
    return {
      executionId: ExecutionIdSchema.make(`exec_sdk_${id}`),
      interactionId: `executor.sdk.${id}` as never,
    };
  };
  const effect = {
    local: {
      installation: () => provide(getLocalInstallation()),
      config: () => provide(getLocalInstanceConfig()),
      credentials: {
        get: ({ sourceId, interactionId }) =>
          provide(
            getSourceCredentialInteraction({
              scopeId,
              sourceId,
              interactionId,
            }),
          ),
        submit: ({ sourceId, interactionId, action, token }) =>
          provide(
            submitSourceCredentialInteraction({
              scopeId,
              sourceId,
              interactionId,
              action,
              token,
            }),
          ),
        complete: ({ sourceId, state, code, error, errorDescription }) =>
          provide(
            completeSourceCredentialSetup({
              scopeId,
              sourceId,
              state,
              code,
              error,
              errorDescription,
            }),
          ),
      },
    },
    secrets: {
      list: () => provide(listLocalSecrets()),
      create: (payload: CreateSecretPayload) => provide(createLocalSecret(payload)),
      update: (input: { secretId: string; payload: UpdateSecretPayload }) =>
        provide(updateLocalSecret(input)),
      remove: (secretId: string) => provide(deleteLocalSecret(secretId)),
    },
    policies: {
      list: () => provide(listPolicies(scopeId)),
      create: (payload: CreatePolicyPayload) =>
        provide(createPolicy({ scopeId, payload })),
      get: (policyId: string) =>
        provide(getPolicy({ scopeId, policyId: policyId as never })),
      update: (policyId: string, payload: UpdatePolicyPayload) =>
        provide(updatePolicy({ scopeId, policyId: policyId as never, payload })),
      remove: (policyId: string) =>
        provide(removePolicy({ scopeId, policyId: policyId as never })),
    },
    sources: {
      add: (input: ExecutorSourceInput, options?: { baseUrl?: string | null }) =>
        provideSourceAuth((service) => {
          const session = createSdkSourceSession();
          return service.addExecutorSource(
            {
              ...input,
              scopeId,
              actorScopeId: actorScopeId,
              executionId: session.executionId,
              interactionId: session.interactionId,
            },
            options,
          );
        }),
      connect: (payload: ExecutorMcpSourceInput) =>
        provideSourceAuth((service) =>
          service.connectMcpSource({
            ...payload,
            scopeId,
            actorScopeId: actorScopeId,
          }),
        ),
      connectBatch: (payload: ExecutorSourceBatchInput) =>
        provideSourceAuth((service) => {
          const session = createSdkSourceSession();
          return service.connectGoogleDiscoveryBatch({
            ...payload,
            scopeId,
            actorScopeId: actorScopeId,
            executionId: session.executionId,
            interactionId: session.interactionId,
          });
        }),
      discover: (input: {
        url: string;
        probeAuth?: Parameters<typeof discoverSource>[0]["probeAuth"];
      }) => provide(discoverSource(input)),
      list: () => provide(listSources({ scopeId, actorScopeId })),
      create: (payload: CreateSourcePayload) =>
        provide(createSource({ scopeId, actorScopeId, payload })),
      get: (sourceId: Source["id"]) =>
        provide(getSource({ scopeId, sourceId, actorScopeId })),
      update: (sourceId: Source["id"], payload: UpdateSourcePayload) =>
        provide(updateSource({ scopeId, sourceId, actorScopeId, payload })),
      remove: (sourceId: Source["id"]) =>
        provide(removeSource({ scopeId, sourceId })),
      inspection: {
        get: (sourceId: Source["id"]) =>
          provide(getSourceInspection({ scopeId, sourceId })),
        tool: ({ sourceId, toolPath }: { sourceId: Source["id"]; toolPath: string }) =>
          provide(
            getSourceInspectionToolDetail({
              scopeId,
              sourceId,
              toolPath,
            }),
          ),
        discover: ({
          sourceId,
          payload,
        }: {
          sourceId: Source["id"];
          payload: Parameters<typeof discoverSourceInspectionTools>[0]["payload"];
        }) =>
          provide(
            discoverSourceInspectionTools({
              scopeId,
              sourceId,
              payload,
            }),
          ),
      },
      oauthClients: {
        list: (providerKey: string) =>
          provideSourceAuth((service) =>
            service.listScopeOauthClients({
              scopeId,
              providerKey,
            }),
          ),
        create: (payload: CreateScopeOauthClientPayload) =>
          provideSourceAuth((service) =>
            service.createScopeOauthClient({
              scopeId,
              providerKey: payload.providerKey,
              label: payload.label,
              oauthClient: payload.oauthClient,
            }),
          ),
        remove: (oauthClientId: ScopeOauthClient["id"]) =>
          provideSourceAuth((service) =>
            service.removeScopeOauthClient({
              scopeId,
              oauthClientId,
            }),
          ),
      },
      providerGrants: {
        remove: (grantId: ProviderAuthGrant["id"]) =>
          provideSourceAuth((service) =>
            service.removeProviderAuthGrant({
              scopeId,
              grantId,
            }),
          ),
      },
    },
    oauth: {
      startSourceAuth: (input: ExecutorSourceOAuthInput) =>
        provideSourceAuth((service) =>
          service.startSourceOAuthSession({
            ...input,
            scopeId,
            actorScopeId: actorScopeId,
          }),
        ),
      completeSourceAuth: ({ state, code, error, errorDescription }) =>
        provideSourceAuth((service) =>
          service.completeSourceOAuthSession({
            state,
            code,
            error,
            errorDescription,
          }),
        ),
      completeProviderCallback: (input) =>
        provideSourceAuth((service) =>
          service.completeProviderOauthCallback({
            ...input,
            scopeId: input.scopeId ?? scopeId,
            actorScopeId: input.actorScopeId ?? actorScopeId,
          }),
        ),
    },
    executions: {
      create: (payload: CreateExecutionPayload) =>
        provide(
          createExecution({
            scopeId,
            payload,
            createdByScopeId: actorScopeId,
          }),
        ),
      get: (executionId: Execution["id"]) =>
        provide(getExecution({ scopeId, executionId })),
      resume: (executionId: Execution["id"], payload: ResumeExecutionPayload) =>
        provide(
          resumeExecution({
            scopeId,
            executionId,
            payload,
            resumedByScopeId: actorScopeId,
          }),
        ),
    },
  } satisfies Executor["effect"];

  return {
    runtime,
    installation,
    scopeId,
    actorScopeId,
    resolutionScopeIds: installation.resolutionScopeIds,
    provide,
    run,
    close: () => runtime.close(),
    effect,
    local: {
      installation: () => run(effect.local.installation()),
      config: () => run(effect.local.config()),
      credentials: {
        get: ({ sourceId, interactionId }) =>
          run(effect.local.credentials.get({ sourceId, interactionId })),
        submit: ({ sourceId, interactionId, action, token }) =>
          run(effect.local.credentials.submit({ sourceId, interactionId, action, token })),
        complete: ({ sourceId, state, code, error, errorDescription }) =>
          run(effect.local.credentials.complete({ sourceId, state, code, error, errorDescription })),
      },
    },
    secrets: {
      list: () => run(effect.secrets.list()),
      create: (payload) => run(effect.secrets.create(payload)),
      update: (input) => run(effect.secrets.update(input)),
      remove: (secretId) => run(effect.secrets.remove(secretId)),
    },
    policies: {
      list: () => run(effect.policies.list()),
      create: (payload) => run(effect.policies.create(payload)),
      get: (policyId) => run(effect.policies.get(policyId)),
      update: (policyId, payload) =>
        run(effect.policies.update(policyId, payload)),
      remove: async (policyId) =>
        (await run(effect.policies.remove(policyId))).removed,
    },
    sources: {
      add: (input, options) => run(effect.sources.add(input, options)),
      connect: (payload) => run(effect.sources.connect(payload)),
      connectBatch: (payload) => run(effect.sources.connectBatch(payload)),
      discover: (input) => run(effect.sources.discover(input)),
      list: () => run(effect.sources.list()),
      create: (payload) => run(effect.sources.create(payload)),
      get: (sourceId) => run(effect.sources.get(sourceId)),
      update: (sourceId, payload) =>
        run(effect.sources.update(sourceId, payload)),
      remove: async (sourceId) =>
        (await run(effect.sources.remove(sourceId))).removed,
      inspection: {
        get: (sourceId) => run(effect.sources.inspection.get(sourceId)),
        tool: ({ sourceId, toolPath }) =>
          run(effect.sources.inspection.tool({ sourceId, toolPath })),
        discover: ({ sourceId, payload }) =>
          run(effect.sources.inspection.discover({ sourceId, payload })),
      },
      oauthClients: {
        list: (providerKey) =>
          run(effect.sources.oauthClients.list(providerKey)),
        create: (payload) => run(effect.sources.oauthClients.create(payload)),
        remove: (oauthClientId) =>
          run(effect.sources.oauthClients.remove(oauthClientId)),
      },
      providerGrants: {
        remove: (grantId) =>
          run(effect.sources.providerGrants.remove(grantId)),
      },
    },
    oauth: {
      startSourceAuth: (input) => run(effect.oauth.startSourceAuth(input)),
      completeSourceAuth: ({ state, code, error, errorDescription }) =>
        run(effect.oauth.completeSourceAuth({ state, code, error, errorDescription })),
      completeProviderCallback: (input) =>
        run(effect.oauth.completeProviderCallback(input)),
    },
    executions: {
      create: (payload) => run(effect.executions.create(payload)),
      get: (executionId) => run(effect.executions.get(executionId)),
      resume: (executionId, payload) =>
        run(effect.executions.resume(executionId, payload)),
    },
  };
};

export const createExecutorEffect = (
  options: CreateExecutorOptions,
): Effect.Effect<Executor, Error> =>
  Effect.map(
    options.backend.createRuntime({
      executionResolver: options.executionResolver,
      createInternalToolMap: options.createInternalToolMap,
      resolveSecretMaterial: options.resolveSecretMaterial,
      getLocalServerBaseUrl: options.getLocalServerBaseUrl,
    }),
    fromRuntime,
  );

export const createExecutor = async (
  options: CreateExecutorOptions,
): Promise<Executor> => Effect.runPromise(createExecutorEffect(options));
