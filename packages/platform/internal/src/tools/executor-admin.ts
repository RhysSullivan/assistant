import { toTool, type ToolMap } from "@executor/codemode-core";
import type { Executor } from "@executor/platform-sdk";
import {
  type ScopeId as AccountId,
  LocalInstallationSchema,
  LocalScopePolicySchema,
  SourceDiscoveryResultSchema,
  SourceIdSchema,
  SourceInspectionDiscoverPayloadSchema,
  SourceInspectionDiscoverResultSchema,
  SourceInspectionSchema,
  SourceInspectionToolDetailSchema,
  SourceSchema,
  type ScopeId as WorkspaceId,
  ScopeOauthClientSchema,
} from "@executor/platform-sdk/schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  ExecutorStateStore,
  LocalInstanceConfigService,
  SecretMaterialDeleterService,
  SecretMaterialStorerService,
  SecretMaterialUpdaterService,
  type ExecutorStateStoreShape,
  type ScopeInternalToolContext as WorkspaceInternalToolContext,
  RuntimeSourceAuthService,
  RuntimeSourceCatalogSyncService,
  RuntimeSourceStore,
  RuntimeSourceStoreService,
} from "@executor/platform-sdk/runtime";
import {
  type RuntimeLocalScopeState,
  provideOptionalRuntimeLocalScope,
} from "../../../sdk/src/runtime/scope/runtime-context";
import {
  SourceArtifactStore,
  type SourceArtifactStoreShape,
  ScopeConfigStore,
  type ScopeConfigStoreShape,
  ScopeStateStore,
  type ScopeStateStoreShape,
  makeScopeStorageLayer,
} from "../../../sdk/src/runtime/scope/storage";
import {
  CreateSecretPayloadSchema,
  CreateSecretResultSchema,
  type CreateSecretPayload,
  DeleteSecretResultSchema,
  InstanceConfigSchema,
  SecretListItemSchema,
  UpdateSecretPayloadSchema,
  UpdateSecretResultSchema,
  type UpdateSecretPayload,
} from "@executor/platform-sdk/contracts";
import {
  createLocalSecret,
  createPolicy,
  deleteLocalSecret,
  discoverSource,
  discoverSourceInspectionTools,
  getPolicy,
  getSource,
  getSourceInspection,
  getSourceInspectionToolDetail,
  listLocalSecrets,
  listPolicies,
  listSources,
  removePolicy,
  removeSource,
  updateLocalSecret,
  updatePolicy,
  updateSource,
} from "@executor/platform-sdk/operations";
import {
  CreatePolicyPayloadSchema,
  type CreatePolicyPayload,
  type UpdatePolicyPayload,
  UpdatePolicyPayloadSchema,
} from "@executor/platform-sdk/contracts";
import {
  CreateScopeOauthClientPayloadSchema,
  DiscoverSourcePayloadSchema,
  type CreateScopeOauthClientPayload as CreateWorkspaceOauthClientPayload,
  UpdateSourcePayloadSchema,
} from "@executor/platform-sdk/contracts";

const emptyInputSchema = Schema.standardSchemaV1(Schema.Struct({}));
const localInstallationOutputSchema = Schema.standardSchemaV1(
  LocalInstallationSchema,
);
const instanceConfigOutputSchema =
  Schema.standardSchemaV1(InstanceConfigSchema);
const secretListOutputSchema = Schema.standardSchemaV1(
  Schema.Array(SecretListItemSchema),
);
const createSecretInputSchema = Schema.standardSchemaV1(
  CreateSecretPayloadSchema,
);
const updateSecretInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    secretId: Schema.String,
    payload: UpdateSecretPayloadSchema,
  }),
);
const removeSecretInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    secretId: Schema.String,
  }),
);
const removeResultSchema = Schema.standardSchemaV1(
  Schema.Struct({
    removed: Schema.Boolean,
  }),
);
const listSourcesOutputSchema = Schema.standardSchemaV1(
  Schema.Array(SourceSchema),
);
const getSourceInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    sourceId: SourceIdSchema,
  }),
);
const updateSourceInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    sourceId: SourceIdSchema,
    payload: UpdateSourcePayloadSchema,
  }),
);
const discoverSourceInputSchema = Schema.standardSchemaV1(
  DiscoverSourcePayloadSchema,
);
const inspectToolInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    sourceId: SourceIdSchema,
    toolPath: Schema.String,
  }),
);
const inspectDiscoverInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    sourceId: SourceIdSchema,
    payload: SourceInspectionDiscoverPayloadSchema,
  }),
);
const listPoliciesOutputSchema = Schema.standardSchemaV1(
  Schema.Array(LocalScopePolicySchema),
);
const policyIdInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    policyId: Schema.String,
  }),
);
const createPolicyInputSchema = Schema.standardSchemaV1(
  CreatePolicyPayloadSchema,
);
const updatePolicyInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    policyId: Schema.String,
    payload: UpdatePolicyPayloadSchema,
  }),
);
const workspaceOauthClientListInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    providerKey: Schema.String,
  }),
);
const workspaceOauthClientListOutputSchema = Schema.standardSchemaV1(
  Schema.Array(ScopeOauthClientSchema),
);
const createWorkspaceOauthClientInputSchema = Schema.standardSchemaV1(
  CreateScopeOauthClientPayloadSchema,
);
const removeWorkspaceOauthClientInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    oauthClientId: Schema.String,
  }),
);
const removeProviderGrantInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    grantId: Schema.String,
  }),
);
const sourceOutputSchema = Schema.standardSchemaV1(SourceSchema);
const sourceInspectionOutputSchema = Schema.standardSchemaV1(
  SourceInspectionSchema,
);
const sourceInspectionToolOutputSchema = Schema.standardSchemaV1(
  SourceInspectionToolDetailSchema,
);
const sourceInspectionDiscoverOutputSchema = Schema.standardSchemaV1(
  SourceInspectionDiscoverResultSchema,
);
const sourceDiscoveryOutputSchema = Schema.standardSchemaV1(
  SourceDiscoveryResultSchema,
);
const localScopePolicyOutputSchema = Schema.standardSchemaV1(
  LocalScopePolicySchema,
);

const makeRuntimeLayer = (input: {
  executorStateStore: ExecutorStateStoreShape;
  sourceStore: RuntimeSourceStore;
  sourceCatalogSyncService: Effect.Effect.Success<
    typeof RuntimeSourceCatalogSyncService
  >;
  scopeConfigStore: ScopeConfigStoreShape;
  scopeStateStore: ScopeStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
  instanceConfigResolver: WorkspaceInternalToolContext["instanceConfigResolver"];
  storeSecretMaterial: WorkspaceInternalToolContext["storeSecretMaterial"];
  deleteSecretMaterial: WorkspaceInternalToolContext["deleteSecretMaterial"];
  updateSecretMaterial: WorkspaceInternalToolContext["updateSecretMaterial"];
}) =>
  Layer.mergeAll(
    Layer.succeed(ExecutorStateStore, input.executorStateStore),
    Layer.succeed(RuntimeSourceStoreService, input.sourceStore),
    Layer.succeed(
      RuntimeSourceCatalogSyncService,
      input.sourceCatalogSyncService,
    ),
    Layer.succeed(LocalInstanceConfigService, input.instanceConfigResolver),
    Layer.succeed(SecretMaterialStorerService, input.storeSecretMaterial),
    Layer.succeed(SecretMaterialDeleterService, input.deleteSecretMaterial),
    Layer.succeed(SecretMaterialUpdaterService, input.updateSecretMaterial),
    makeScopeStorageLayer({
      scopeConfigStore: input.scopeConfigStore,
      scopeStateStore: input.scopeStateStore,
      sourceArtifactStore: input.sourceArtifactStore,
    }),
  );

const runRuntimeEffect = <A, E, R>(input: {
  effect: Effect.Effect<A, E, R>;
  runtimeLayer: Layer.Layer<
    | ExecutorStateStore
    | LocalInstanceConfigService
    | RuntimeSourceStoreService
    | RuntimeSourceCatalogSyncService
    | SecretMaterialStorerService
    | SecretMaterialDeleterService
    | SecretMaterialUpdaterService
    | ScopeConfigStore
    | ScopeStateStore
    | SourceArtifactStore,
    never,
    never
  >;
  runtimeLocalScope: RuntimeLocalScopeState | null;
}) =>
  Effect.runPromise(
    provideOptionalRuntimeLocalScope(
      input.effect.pipe(Effect.provide(input.runtimeLayer)),
      input.runtimeLocalScope,
    ) as Effect.Effect<A, E, never>,
  );

const runScopeStorageEffect = <A, E, R>(input: {
  effect: Effect.Effect<A, E, R>;
  scopeStorageLayer: Layer.Layer<
    ScopeConfigStore | ScopeStateStore | SourceArtifactStore,
    never,
    never
  >;
  runtimeLocalScope: RuntimeLocalScopeState | null;
}) =>
  Effect.runPromise(
    provideOptionalRuntimeLocalScope(
      input.effect.pipe(Effect.provide(input.scopeStorageLayer)),
      input.runtimeLocalScope,
    ) as Effect.Effect<A, E, never>,
  );

export const createWorkspaceExecutorAdminToolMap = (
  input: WorkspaceInternalToolContext,
): ToolMap => {
  const runtimeLayer = makeRuntimeLayer({
    executorStateStore: input.executorStateStore,
    sourceStore: input.sourceStore,
    sourceCatalogSyncService: input.sourceCatalogSyncService,
    scopeConfigStore: input.scopeConfigStore,
    scopeStateStore: input.scopeStateStore,
    sourceArtifactStore: input.sourceArtifactStore,
    instanceConfigResolver: input.instanceConfigResolver,
    storeSecretMaterial: input.storeSecretMaterial,
    deleteSecretMaterial: input.deleteSecretMaterial,
    updateSecretMaterial: input.updateSecretMaterial,
  });
  const scopeStorageLayer = makeScopeStorageLayer({
    scopeConfigStore: input.scopeConfigStore,
    scopeStateStore: input.scopeStateStore,
    sourceArtifactStore: input.sourceArtifactStore,
  });

  const metadata = {
    sourceKey: "executor",
    interaction: "auto" as const,
  };

  return {
    "executor.local.installation.get": toTool({
      tool: {
        description:
          "Get the active local executor installation account and workspace ids.",
        inputSchema: emptyInputSchema,
        outputSchema: localInstallationOutputSchema,
        execute: async () => ({
          scopeId: input.scopeId,
          actorScopeId: input.actorScopeId,
        }),
      },
      metadata,
    }),
    "executor.local.config.get": toTool({
      tool: {
        description:
          "Get local instance config such as supported secret providers.",
        inputSchema: emptyInputSchema,
        outputSchema: instanceConfigOutputSchema,
        execute: () => Effect.runPromise(input.instanceConfigResolver()),
      },
      metadata,
    }),
    "executor.secrets.list": toTool({
      tool: {
        description:
          "List locally stored secrets and the sources linked to them.",
        inputSchema: emptyInputSchema,
        outputSchema: secretListOutputSchema,
        execute: () =>
          runRuntimeEffect({
            effect: listLocalSecrets(),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.secrets.create": toTool({
      tool: {
        description:
          "Create a local secret without putting the raw value into source config.",
        inputSchema: createSecretInputSchema,
        outputSchema: Schema.standardSchemaV1(CreateSecretResultSchema),
        execute: (payload: CreateSecretPayload) =>
          runRuntimeEffect({
            effect: createLocalSecret(payload),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.secrets.update": toTool({
      tool: {
        description:
          "Update a stored secret name and optionally rotate its value.",
        inputSchema: updateSecretInputSchema,
        outputSchema: Schema.standardSchemaV1(UpdateSecretResultSchema),
        execute: (payload: {
          secretId: string;
          payload: UpdateSecretPayload;
        }) =>
          runRuntimeEffect({
            effect: updateLocalSecret(payload),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.secrets.remove": toTool({
      tool: {
        description: "Remove a stored local secret.",
        inputSchema: removeSecretInputSchema,
        outputSchema: Schema.standardSchemaV1(DeleteSecretResultSchema),
        execute: ({ secretId }: { secretId: string }) =>
          runRuntimeEffect({
            effect: deleteLocalSecret(secretId),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.discover": toTool({
      tool: {
        description:
          "Probe a URL and infer whether it looks like MCP, OpenAPI, GraphQL, or another supported source.",
        inputSchema: discoverSourceInputSchema,
        outputSchema: sourceDiscoveryOutputSchema,
        execute: (payload: { url: string; probeAuth?: unknown }) =>
          Effect.runPromise(
            discoverSource({
              url: payload.url,
              probeAuth: payload.probeAuth as never,
            }),
          ),
      },
      metadata,
    }),
    "executor.sources.list": toTool({
      tool: {
        description: "List sources connected in the current workspace.",
        inputSchema: emptyInputSchema,
        outputSchema: listSourcesOutputSchema,
        execute: () =>
          runRuntimeEffect({
            effect: listSources({
              scopeId: input.scopeId,
              actorScopeId: input.actorScopeId as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.get": toTool({
      tool: {
        description: "Get one source by id.",
        inputSchema: getSourceInputSchema,
        outputSchema: sourceOutputSchema,
        execute: ({ sourceId }: { sourceId: string }) =>
          runRuntimeEffect({
            effect: getSource({
              scopeId: input.scopeId,
              sourceId: sourceId as never,
              actorScopeId: input.actorScopeId as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.update": toTool({
      tool: {
        description: "Update a source definition in the current workspace.",
        inputSchema: updateSourceInputSchema,
        outputSchema: sourceOutputSchema,
        execute: (payload: {
          sourceId: string;
          payload: Record<string, unknown>;
        }) =>
          runRuntimeEffect({
            effect: updateSource({
              scopeId: input.scopeId,
              sourceId: payload.sourceId as never,
              actorScopeId: input.actorScopeId as never,
              payload: payload.payload as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.remove": toTool({
      tool: {
        description: "Remove a source from the current workspace.",
        inputSchema: getSourceInputSchema,
        outputSchema: removeResultSchema,
        execute: ({ sourceId }: { sourceId: string }) =>
          runRuntimeEffect({
            effect: removeSource({
              scopeId: input.scopeId,
              sourceId: sourceId as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.inspect.get": toTool({
      tool: {
        description: "Inspect the tool model for one connected source.",
        inputSchema: getSourceInputSchema,
        outputSchema: sourceInspectionOutputSchema,
        execute: ({ sourceId }: { sourceId: string }) =>
          runRuntimeEffect({
            effect: getSourceInspection({
              scopeId: input.scopeId,
              sourceId: sourceId as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.inspect.tool": toTool({
      tool: {
        description: "Inspect one tool inside a connected source.",
        inputSchema: inspectToolInputSchema,
        outputSchema: sourceInspectionToolOutputSchema,
        execute: ({
          sourceId,
          toolPath,
        }: {
          sourceId: string;
          toolPath: string;
        }) =>
          runRuntimeEffect({
            effect: getSourceInspectionToolDetail({
              scopeId: input.scopeId,
              sourceId: sourceId as never,
              toolPath,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.inspect.discover": toTool({
      tool: {
        description: "Search within a single source's inspected tools.",
        inputSchema: inspectDiscoverInputSchema,
        outputSchema: sourceInspectionDiscoverOutputSchema,
        execute: ({
          sourceId,
          payload,
        }: {
          sourceId: string;
          payload: { query: string; limit?: number };
        }) =>
          runRuntimeEffect({
            effect: discoverSourceInspectionTools({
              scopeId: input.scopeId,
              sourceId: sourceId as never,
              payload: payload as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.oauthClients.list": toTool({
      tool: {
        description: "List workspace OAuth clients for a provider key.",
        inputSchema: workspaceOauthClientListInputSchema,
        outputSchema: workspaceOauthClientListOutputSchema,
        execute: ({ providerKey }: { providerKey: string }) =>
          runScopeStorageEffect({
            effect: input.sourceAuthService.listScopeOauthClients({
              scopeId: input.scopeId,
              providerKey,
            }),
            scopeStorageLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.oauthClients.create": toTool({
      tool: {
        description:
          "Create a workspace OAuth client used for shared provider auth flows.",
        inputSchema: createWorkspaceOauthClientInputSchema,
        outputSchema: Schema.standardSchemaV1(ScopeOauthClientSchema),
        execute: (payload: CreateWorkspaceOauthClientPayload) =>
          runScopeStorageEffect({
            effect: input.sourceAuthService.createScopeOauthClient({
              scopeId: input.scopeId,
              providerKey: payload.providerKey,
              label: payload.label,
              oauthClient: payload.oauthClient,
            }),
            scopeStorageLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.oauthClients.remove": toTool({
      tool: {
        description: "Remove a workspace OAuth client.",
        inputSchema: removeWorkspaceOauthClientInputSchema,
        outputSchema: removeResultSchema,
        execute: ({ oauthClientId }: { oauthClientId: string }) =>
          runScopeStorageEffect({
            effect: input.sourceAuthService
              .removeScopeOauthClient({
                scopeId: input.scopeId,
                oauthClientId: oauthClientId as never,
              })
              .pipe(Effect.map((removed) => ({ removed }))),
            scopeStorageLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.sources.providerGrants.remove": toTool({
      tool: {
        description:
          "Revoke a shared provider grant reference from the local workspace.",
        inputSchema: removeProviderGrantInputSchema,
        outputSchema: removeResultSchema,
        execute: ({ grantId }: { grantId: string }) =>
          runScopeStorageEffect({
            effect: input.sourceAuthService
              .removeProviderAuthGrant({
                scopeId: input.scopeId,
                grantId: grantId as never,
              })
              .pipe(Effect.map((removed) => ({ removed }))),
            scopeStorageLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.policies.list": toTool({
      tool: {
        description: "List local workspace policies.",
        inputSchema: emptyInputSchema,
        outputSchema: listPoliciesOutputSchema,
        execute: () =>
          runRuntimeEffect({
            effect: listPolicies(input.scopeId),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.policies.create": toTool({
      tool: {
        description: "Create a local workspace policy.",
        inputSchema: createPolicyInputSchema,
        outputSchema: localScopePolicyOutputSchema,
        execute: (payload: CreatePolicyPayload) =>
          runRuntimeEffect({
            effect: createPolicy({
              scopeId: input.scopeId,
              payload,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.policies.get": toTool({
      tool: {
        description: "Get one local workspace policy by id.",
        inputSchema: policyIdInputSchema,
        outputSchema: localScopePolicyOutputSchema,
        execute: ({ policyId }: { policyId: string }) =>
          runRuntimeEffect({
            effect: getPolicy({
              scopeId: input.scopeId,
              policyId: policyId as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.policies.update": toTool({
      tool: {
        description: "Update a local workspace policy.",
        inputSchema: updatePolicyInputSchema,
        outputSchema: localScopePolicyOutputSchema,
        execute: ({
          policyId,
          payload,
        }: {
          policyId: string;
          payload: UpdatePolicyPayload;
        }) =>
          runRuntimeEffect({
            effect: updatePolicy({
              scopeId: input.scopeId,
              policyId: policyId as never,
              payload,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
    "executor.policies.remove": toTool({
      tool: {
        description: "Remove a local workspace policy.",
        inputSchema: policyIdInputSchema,
        outputSchema: removeResultSchema,
        execute: ({ policyId }: { policyId: string }) =>
          runRuntimeEffect({
            effect: removePolicy({
              scopeId: input.scopeId,
              policyId: policyId as never,
            }),
            runtimeLayer,
            runtimeLocalScope: input.runtimeLocalScope,
          }),
      },
      metadata,
    }),
  };
};

export const createExecutorAdminToolMap = (input: {
  executor: Executor;
}): ToolMap => {
  const metadata = {
    sourceKey: "executor",
    interaction: "auto" as const,
  };

  return {
    "executor.local.installation.get": toTool({
      tool: {
        description:
          "Get the active local executor installation account and workspace ids.",
        inputSchema: emptyInputSchema,
        outputSchema: localInstallationOutputSchema,
        execute: () => Promise.resolve(input.executor.installation),
      },
      metadata,
    }),
    "executor.local.config.get": toTool({
      tool: {
        description:
          "Get local instance config such as supported secret providers.",
        inputSchema: emptyInputSchema,
        outputSchema: instanceConfigOutputSchema,
        execute: () => input.executor.local.config(),
      },
      metadata,
    }),
    "executor.secrets.list": toTool({
      tool: {
        description:
          "List locally stored secrets and the sources linked to them.",
        inputSchema: emptyInputSchema,
        outputSchema: secretListOutputSchema,
        execute: () => input.executor.secrets.list(),
      },
      metadata,
    }),
    "executor.secrets.create": toTool({
      tool: {
        description:
          "Create a local secret without putting the raw value into source config.",
        inputSchema: createSecretInputSchema,
        outputSchema: Schema.standardSchemaV1(CreateSecretResultSchema),
        execute: (payload: CreateSecretPayload) =>
          input.executor.secrets.create(payload),
      },
      metadata,
    }),
    "executor.secrets.update": toTool({
      tool: {
        description:
          "Update a stored secret name and optionally rotate its value.",
        inputSchema: updateSecretInputSchema,
        outputSchema: Schema.standardSchemaV1(UpdateSecretResultSchema),
        execute: (payload: {
          secretId: string;
          payload: UpdateSecretPayload;
        }) => input.executor.secrets.update(payload),
      },
      metadata,
    }),
    "executor.secrets.remove": toTool({
      tool: {
        description: "Remove a stored local secret.",
        inputSchema: removeSecretInputSchema,
        outputSchema: Schema.standardSchemaV1(DeleteSecretResultSchema),
        execute: ({ secretId }: { secretId: string }) =>
          input.executor.secrets.remove(secretId),
      },
      metadata,
    }),
    "executor.sources.discover": toTool({
      tool: {
        description:
          "Probe a URL and infer whether it looks like MCP, OpenAPI, GraphQL, or another supported source.",
        inputSchema: discoverSourceInputSchema,
        outputSchema: sourceDiscoveryOutputSchema,
        execute: (payload: { url: string; probeAuth?: unknown }) =>
          input.executor.sources.discover({
            url: payload.url,
            probeAuth: payload.probeAuth as never,
          }),
      },
      metadata,
    }),
    "executor.sources.list": toTool({
      tool: {
        description: "List sources connected in the current workspace.",
        inputSchema: emptyInputSchema,
        outputSchema: listSourcesOutputSchema,
        execute: () => input.executor.sources.list(),
      },
      metadata,
    }),
    "executor.sources.get": toTool({
      tool: {
        description: "Get one source by id.",
        inputSchema: getSourceInputSchema,
        outputSchema: sourceOutputSchema,
        execute: ({ sourceId }: { sourceId: string }) =>
          input.executor.sources.get(sourceId as never),
      },
      metadata,
    }),
    "executor.sources.update": toTool({
      tool: {
        description: "Update a source definition in the current workspace.",
        inputSchema: updateSourceInputSchema,
        outputSchema: sourceOutputSchema,
        execute: (payload: {
          sourceId: string;
          payload: Record<string, unknown>;
        }) =>
          input.executor.sources.update(
            payload.sourceId as never,
            payload.payload as never,
          ),
      },
      metadata,
    }),
    "executor.sources.remove": toTool({
      tool: {
        description: "Remove a source from the current workspace.",
        inputSchema: getSourceInputSchema,
        outputSchema: removeResultSchema,
        execute: async ({ sourceId }: { sourceId: string }) => ({
          removed: await input.executor.sources.remove(sourceId as never),
        }),
      },
      metadata,
    }),
    "executor.sources.inspect.get": toTool({
      tool: {
        description: "Inspect the tool model for one connected source.",
        inputSchema: getSourceInputSchema,
        outputSchema: sourceInspectionOutputSchema,
        execute: ({ sourceId }: { sourceId: string }) =>
          input.executor.sources.inspection.get(sourceId as never),
      },
      metadata,
    }),
    "executor.sources.inspect.tool": toTool({
      tool: {
        description: "Inspect one tool inside a connected source.",
        inputSchema: inspectToolInputSchema,
        outputSchema: sourceInspectionToolOutputSchema,
        execute: ({
          sourceId,
          toolPath,
        }: {
          sourceId: string;
          toolPath: string;
        }) =>
          input.executor.sources.inspection.tool({
            sourceId: sourceId as never,
            toolPath,
          }),
      },
      metadata,
    }),
    "executor.sources.inspect.discover": toTool({
      tool: {
        description: "Search within a single source's inspected tools.",
        inputSchema: inspectDiscoverInputSchema,
        outputSchema: sourceInspectionDiscoverOutputSchema,
        execute: ({
          sourceId,
          payload,
        }: {
          sourceId: string;
          payload: { query: string; limit?: number };
        }) =>
          input.executor.sources.inspection.discover({
            sourceId: sourceId as never,
            payload: payload as never,
          }),
      },
      metadata,
    }),
    "executor.sources.oauthClients.list": toTool({
      tool: {
        description: "List stored workspace OAuth clients for one provider.",
        inputSchema: workspaceOauthClientListInputSchema,
        outputSchema: workspaceOauthClientListOutputSchema,
        execute: ({ providerKey }: { providerKey: string }) =>
          input.executor.sources.oauthClients.list(providerKey),
      },
      metadata,
    }),
    "executor.sources.oauthClients.create": toTool({
      tool: {
        description:
          "Create a workspace OAuth client for a provider-backed source flow.",
        inputSchema: createWorkspaceOauthClientInputSchema,
        outputSchema: Schema.standardSchemaV1(ScopeOauthClientSchema),
        execute: (payload: CreateWorkspaceOauthClientPayload) =>
          input.executor.sources.oauthClients.create(payload),
      },
      metadata,
    }),
    "executor.sources.oauthClients.remove": toTool({
      tool: {
        description: "Remove a stored workspace OAuth client.",
        inputSchema: removeWorkspaceOauthClientInputSchema,
        outputSchema: removeResultSchema,
        execute: async ({
          oauthClientId,
        }: {
          oauthClientId: string;
        }) => ({
          removed: await input.executor.sources.oauthClients.remove(
            oauthClientId as never,
          ),
        }),
      },
      metadata,
    }),
    "executor.sources.providerGrants.remove": toTool({
      tool: {
        description: "Remove one stored provider auth grant.",
        inputSchema: removeProviderGrantInputSchema,
        outputSchema: removeResultSchema,
        execute: async ({ grantId }: { grantId: string }) => ({
          removed: await input.executor.sources.providerGrants.remove(
            grantId as never,
          ),
        }),
      },
      metadata,
    }),
    "executor.policies.list": toTool({
      tool: {
        description: "List local workspace policies.",
        inputSchema: emptyInputSchema,
        outputSchema: listPoliciesOutputSchema,
        execute: () => input.executor.policies.list(),
      },
      metadata,
    }),
    "executor.policies.create": toTool({
      tool: {
        description: "Create a local workspace policy.",
        inputSchema: createPolicyInputSchema,
        outputSchema: localScopePolicyOutputSchema,
        execute: (payload: CreatePolicyPayload) =>
          input.executor.policies.create(payload),
      },
      metadata,
    }),
    "executor.policies.get": toTool({
      tool: {
        description: "Get one local workspace policy by id.",
        inputSchema: policyIdInputSchema,
        outputSchema: localScopePolicyOutputSchema,
        execute: ({ policyId }: { policyId: string }) =>
          input.executor.policies.get(policyId),
      },
      metadata,
    }),
    "executor.policies.update": toTool({
      tool: {
        description: "Update a local workspace policy.",
        inputSchema: updatePolicyInputSchema,
        outputSchema: localScopePolicyOutputSchema,
        execute: ({
          policyId,
          payload,
        }: {
          policyId: string;
          payload: UpdatePolicyPayload;
        }) => input.executor.policies.update(policyId, payload),
      },
      metadata,
    }),
    "executor.policies.remove": toTool({
      tool: {
        description: "Remove a local workspace policy.",
        inputSchema: policyIdInputSchema,
        outputSchema: removeResultSchema,
        execute: async ({ policyId }: { policyId: string }) => ({
          removed: await input.executor.policies.remove(policyId),
        }),
      },
      metadata,
    }),
  };
};
