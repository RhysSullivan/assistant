import {
  type ElicitationResponse,
  type OnElicitation,
  type ToolInvocationContext,
  type ToolMetadata,
  toTool,
  type ToolMap,
  type ToolPath,
} from "@executor/codemode-core";
import {
  type AccountId,
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  SourceSchema,
  type Source,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import type { RuntimeLocalWorkspaceState } from "../local/runtime-context";
import {
  type LocalStorageServices,
  LocalInstallationStore,
  LocalSourceArtifactStore,
  LocalWorkspaceConfigStore,
  LocalWorkspaceStateStore,
  makeLocalStorageLayer,
} from "../local/storage";
import { provideOptionalRuntimeLocalWorkspace } from "../local/runtime-context";

/** Run an Effect as a Promise, preserving the original error (not FiberFailure). */
const runEffect = async <A>(
  effect: Effect.Effect<A, unknown, LocalStorageServices>,
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState | null = null,
): Promise<A> => {
  const baseLayer = makeLocalStorageLayer({
    installationStore: LocalInstallationStore,
    workspaceConfigStore: LocalWorkspaceConfigStore,
    workspaceStateStore: LocalWorkspaceStateStore,
    sourceArtifactStore: LocalSourceArtifactStore,
  });
  const exit = await Effect.runPromiseExit(
    provideOptionalRuntimeLocalWorkspace(
      effect.pipe(Effect.provide(baseLayer)),
      runtimeLocalWorkspace,
    ),
  );
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

import {
  type ExecutorAddSourceInput,
  type ExecutorCredentialManagedSourceInput,
  type ExecutorHttpSourceAuthInput,
  type ExecutorMcpSourceInput,
  type RuntimeSourceAuthService,
} from "./source-auth-service";
import {
  deriveSchemaJson,
  deriveSchemaTypeSignature,
} from "../catalog/schema-type-signature";
import {
  ExecutorAddSourceInputSchema,
  executorAddableSourceAdapters,
  sourceAdapterRequiresInteractiveConnect,
} from "./source-adapters";
import { decodeSourceCredentialSelectionContent } from "./source-credential-interactions";

const ExecutorSourcesAddInputSchema = Schema.standardSchemaV1(
  ExecutorAddSourceInputSchema,
);

const ExecutorSourcesAddOutputSchema = Schema.standardSchemaV1(SourceSchema);

export const EXECUTOR_SOURCES_ADD_INPUT_HINT = deriveSchemaTypeSignature(
  ExecutorAddSourceInputSchema,
  320,
);

export const EXECUTOR_SOURCES_ADD_OUTPUT_SIGNATURE = deriveSchemaTypeSignature(
  SourceSchema,
  260,
);

export const EXECUTOR_SOURCES_ADD_INPUT_SCHEMA = deriveSchemaJson(
  ExecutorAddSourceInputSchema,
) ?? {};

export const EXECUTOR_SOURCES_ADD_OUTPUT_SCHEMA = deriveSchemaJson(
  SourceSchema,
) ?? {};

export const EXECUTOR_SOURCES_ADD_HELP_LINES = [
  "Source add input shapes:",
  ...executorAddableSourceAdapters.flatMap((adapter) =>
    adapter.executorAddInputSchema
    && adapter.executorAddInputSignatureWidth !== null
    && adapter.executorAddHelpText
      ? [
          `- ${adapter.displayName}: ${deriveSchemaTypeSignature(adapter.executorAddInputSchema, adapter.executorAddInputSignatureWidth)}`,
          ...adapter.executorAddHelpText.map((line) => `  ${line}`),
        ]
      : [],
  ),
  "  executor handles the credential setup for you.",
] as const;

export const buildExecutorSourcesAddDescription = (): string =>
  [
    "Add an MCP, OpenAPI, or GraphQL source to the current workspace.",
    ...EXECUTOR_SOURCES_ADD_HELP_LINES,
  ].join("\n");

const toExecutionId = (value: unknown) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing execution run id for executor.sources.add");
  }

  return ExecutionIdSchema.make(value);
};

const asToolPath = (value: string): ToolPath => value as ToolPath;

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toSerializableValue = <A>(value: A): A =>
  JSON.parse(JSON.stringify(value)) as A;

type ExecutorSourcesAddToolArgs =
  | Omit<ExecutorMcpSourceInput, "workspaceId" | "actorAccountId" | "executionId" | "interactionId">
  | Omit<
      ExecutorCredentialManagedSourceInput,
      "workspaceId" | "actorAccountId" | "executionId" | "interactionId"
    >;

type ExecutorGoogleDiscoveryToolArgs = Omit<
  Extract<ExecutorCredentialManagedSourceInput, { service: string; version: string }>,
  "workspaceId" | "actorAccountId" | "executionId" | "interactionId"
>;

type ExecutorOpenApiToolArgs = Omit<
  Extract<ExecutorCredentialManagedSourceInput, { specUrl: string }>,
  "workspaceId" | "actorAccountId" | "executionId" | "interactionId"
>;

type ExecutorGraphqlToolArgs = Omit<
  Extract<ExecutorCredentialManagedSourceInput, { kind: "graphql" }>,
  "workspaceId" | "actorAccountId" | "executionId" | "interactionId"
>;

type ExecutorCredentialPromptArgs = {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  kind: ExecutorCredentialManagedSourceInput["kind"];
  endpoint?: string;
  specUrl?: string;
  service?: string;
  version?: string;
  discoveryUrl?: string | null;
  name?: string | null;
  namespace?: string | null;
};

const isExecutorMcpToolArgs = (
  args: ExecutorSourcesAddToolArgs,
): args is Omit<ExecutorMcpSourceInput, "workspaceId" | "actorAccountId" | "executionId" | "interactionId"> =>
  args.kind === undefined || sourceAdapterRequiresInteractiveConnect(args.kind);

const isExecutorCredentialManagedSourceInput = (
  input: ExecutorAddSourceInput,
): input is ExecutorCredentialManagedSourceInput =>
  typeof input.kind === "string";

const prepareExecutorAddSourceInput = (input: {
  args: ExecutorSourcesAddToolArgs;
  workspaceId: WorkspaceId;
  accountId: AccountId;
  executionId: ReturnType<typeof toExecutionId>;
  interactionId: ReturnType<typeof ExecutionInteractionIdSchema.make>;
}): ExecutorAddSourceInput => {
  if (isExecutorMcpToolArgs(input.args)) {
    return {
      kind: input.args.kind,
      endpoint: input.args.endpoint,
      name: input.args.name ?? null,
      namespace: input.args.namespace ?? null,
      workspaceId: input.workspaceId,
      actorAccountId: input.accountId,
      executionId: input.executionId,
      interactionId: input.interactionId,
    } satisfies ExecutorMcpSourceInput;
  }

  if ("service" in input.args) {
    const args = input.args as ExecutorGoogleDiscoveryToolArgs;
    return {
      ...args,
      workspaceId: input.workspaceId,
      actorAccountId: input.accountId,
      executionId: input.executionId,
      interactionId: input.interactionId,
    } satisfies Extract<ExecutorCredentialManagedSourceInput, { service: string; version: string }>;
  }

  if ("specUrl" in input.args) {
    const args = input.args as ExecutorOpenApiToolArgs;
    return {
      ...args,
      workspaceId: input.workspaceId,
      actorAccountId: input.accountId,
      executionId: input.executionId,
      interactionId: input.interactionId,
    } satisfies Extract<ExecutorCredentialManagedSourceInput, { specUrl: string }>;
  }

  const args = input.args as ExecutorGraphqlToolArgs;
  return {
    ...args,
    workspaceId: input.workspaceId,
    actorAccountId: input.accountId,
    executionId: input.executionId,
    interactionId: input.interactionId,
  } satisfies Extract<ExecutorCredentialManagedSourceInput, { kind: "graphql" }>;
};

const resolveLocalCredentialUrl = (input: {
  baseUrl: string;
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  executionId: string;
  interactionId: string;
}): string =>
  new URL(
    `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/sources/${encodeURIComponent(input.sourceId)}/credentials?interactionId=${encodeURIComponent(`${input.executionId}:${input.interactionId}`)}`,
    input.baseUrl,
  ).toString();

const promptForSourceCredentialSelection = (input: {
  args: ExecutorCredentialPromptArgs;
  credentialSlot: "runtime" | "import";
  source: Source;
  executionId: string;
  interactionId: string;
  path: ToolPath;
  sourceKey: string;
  localServerBaseUrl: string | null;
  metadata?: ToolMetadata;
  invocation?: ToolInvocationContext;
  onElicitation?: OnElicitation;
}) =>
  Effect.gen(function* () {
    if (!input.onElicitation) {
      return yield* Effect.fail(
        new Error("executor.sources.add requires an elicitation-capable host"),
      );
    }

    if (input.localServerBaseUrl === null) {
      return yield* Effect.fail(
        new Error("executor.sources.add requires a local server base URL for credential capture"),
      );
    }

    const response: ElicitationResponse = yield* input.onElicitation({
      interactionId: input.interactionId,
      path: input.path,
      sourceKey: input.sourceKey,
      args: input.args,
      metadata: input.metadata,
      context: input.invocation,
      elicitation: {
        mode: "url",
        message:
          input.credentialSlot === "import"
            ? `Open the secure credential page to configure import access for ${input.source.name}`
            : `Open the secure credential page to connect ${input.source.name}`,
        url: resolveLocalCredentialUrl({
          baseUrl: input.localServerBaseUrl,
          workspaceId: input.args.workspaceId,
          sourceId: input.args.sourceId,
          executionId: input.executionId,
          interactionId: input.interactionId,
        }),
        elicitationId: input.interactionId,
      },
    }).pipe(Effect.mapError((cause) => cause instanceof Error ? cause : new Error(String(cause))));

    if (response.action !== "accept") {
      return yield* Effect.fail(
        new Error(`Source credential setup was not completed for ${input.source.name}`),
      );
    }

    const content = yield* Effect.try({
      try: () => decodeSourceCredentialSelectionContent(response.content),
      catch: () =>
        new Error("Credential capture did not return a valid source auth choice for executor.sources.add"),
    });

    if (content.authKind === "none") {
      return { kind: "none" } satisfies ExecutorHttpSourceAuthInput;
    }

    return {
      kind: "bearer",
      tokenRef: content.tokenRef,
    } satisfies ExecutorHttpSourceAuthInput;
  });

export const createExecutorToolMap = (input: {
  workspaceId: WorkspaceId;
  accountId: AccountId;
  sourceAuthService: RuntimeSourceAuthService;
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState | null;
}): ToolMap => ({
  "executor.sources.add": toTool({
    tool: {
      description: buildExecutorSourcesAddDescription(),
      inputSchema: ExecutorSourcesAddInputSchema,
      outputSchema: ExecutorSourcesAddOutputSchema,
      execute: async (args: ExecutorSourcesAddToolArgs, context): Promise<Source> => {
        const executionId = toExecutionId(context?.invocation?.runId);
        const interactionId = ExecutionInteractionIdSchema.make(
          `executor.sources.add:${crypto.randomUUID()}`,
        );
        const preparedArgs = prepareExecutorAddSourceInput({
          args,
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          executionId,
          interactionId,
        });
        let result = await runEffect(
          input.sourceAuthService.addExecutorSource(
            preparedArgs,
            context?.onElicitation
              ? {
                mcpDiscoveryElicitation: {
                  onElicitation: context.onElicitation,
                  path: context.path ?? asToolPath("executor.sources.add"),
                  sourceKey: context.sourceKey,
                  args,
                  metadata: context.metadata,
                  invocation: context.invocation,
                },
              }
              : undefined,
          ),
          input.runtimeLocalWorkspace,
        );

        if (result.kind === "connected") {
          return toSerializableValue(result.source);
        }

        if (result.kind === "credential_required") {
          let pendingResult = result;
          if (!isExecutorCredentialManagedSourceInput(preparedArgs)) {
            throw new Error("Credential-managed source setup expected a named adapter kind");
          }
          let pendingArgs: ExecutorCredentialManagedSourceInput = preparedArgs;

          while (pendingResult.kind === "credential_required") {
            const selectedAuth = await runEffect(
              promptForSourceCredentialSelection({
                args: {
                  ...pendingArgs,
                  workspaceId: input.workspaceId,
                  sourceId: pendingResult.source.id,
                },
                credentialSlot: pendingResult.credentialSlot,
                source: pendingResult.source,
                executionId,
                interactionId,
                path: context?.path ?? asToolPath("executor.sources.add"),
                sourceKey: context?.sourceKey ?? "executor",
                localServerBaseUrl: input.sourceAuthService.getLocalServerBaseUrl(),
                metadata: context?.metadata,
                invocation: context?.invocation,
                onElicitation: context?.onElicitation,
              }),
              input.runtimeLocalWorkspace,
            );

            pendingArgs = pendingResult.credentialSlot === "import"
              && pendingArgs.importAuthPolicy === "separate"
              ? {
                  ...pendingArgs,
                  importAuth: selectedAuth,
                }
              : {
                  ...pendingArgs,
                  auth: selectedAuth,
                };

            const completed = await runEffect(
              input.sourceAuthService.addExecutorSource(
                pendingArgs,
                context?.onElicitation
                  ? {
                    mcpDiscoveryElicitation: {
                      onElicitation: context.onElicitation,
                      path: context.path ?? asToolPath("executor.sources.add"),
                      sourceKey: context.sourceKey,
                      args,
                      metadata: context.metadata,
                      invocation: context.invocation,
                    },
                  }
                  : undefined,
              ),
              input.runtimeLocalWorkspace,
            );

            if (completed.kind === "connected") {
              return toSerializableValue(completed.source);
            }

            if (completed.kind === "credential_required") {
              pendingResult = completed;
              continue;
            }

            result = completed;
            break;
          }

          if (pendingResult.kind === "credential_required") {
            result = pendingResult;
          }
        }

        if (!context?.onElicitation) {
          throw new Error("executor.sources.add requires an elicitation-capable host");
        }

        if (result.kind !== "oauth_required") {
          throw new Error(`Source add did not reach OAuth continuation for ${result.source.id}`);
        }

        const response: ElicitationResponse = await runEffect(
          context.onElicitation({
            interactionId,
            path: context.path ?? asToolPath("executor.sources.add"),
            sourceKey: context.sourceKey,
            args: preparedArgs,
            metadata: context.metadata,
            context: context.invocation,
            elicitation: {
              mode: "url",
              message: `Open the provider sign-in page to connect ${result.source.name}`,
              url: result.authorizationUrl,
              elicitationId: result.sessionId,
            },
          }),
          input.runtimeLocalWorkspace,
        );

        if (response.action !== "accept") {
          throw new Error(`Source add was not completed for ${result.source.id}`);
        }

        const connected = await runEffect(
          input.sourceAuthService.getSourceById({
            workspaceId: input.workspaceId,
            sourceId: result.source.id,
            actorAccountId: input.accountId,
          }),
          input.runtimeLocalWorkspace,
        );
        return toSerializableValue(connected);
      },
    },
    metadata: {
      inputTypePreview: EXECUTOR_SOURCES_ADD_INPUT_HINT,
      outputTypePreview: EXECUTOR_SOURCES_ADD_OUTPUT_SIGNATURE,
      inputSchema: EXECUTOR_SOURCES_ADD_INPUT_SCHEMA,
      outputSchema: EXECUTOR_SOURCES_ADD_OUTPUT_SCHEMA,
      sourceKey: "executor",
      interaction: "auto",
    },
  }),
});
