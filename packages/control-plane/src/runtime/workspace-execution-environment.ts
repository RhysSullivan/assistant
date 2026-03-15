import {
  createSystemToolMap,
  createToolCatalogFromEntries,
  createToolCatalogFromTools,
  makeToolInvokerFromTools,
  mergeToolCatalogs,
  mergeToolMaps,
  type ToolCatalog,
  type ToolInvoker,
  type ToolPath,
} from "@executor/codemode-core";
import { makeQuickJsExecutor } from "@executor/runtime-quickjs";
import type { AccountId, Source } from "#schema";
import * as Context from "effect/Context";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type {
  ExecutionEnvironment,
  ResolveExecutionEnvironment,
} from "./execution-state";
import { createExecutorToolMap } from "./executor-tools";
import {
  RuntimeSourceAuthServiceTag,
  type RuntimeSourceAuthService,
} from "./source-auth-service";
import {
  RuntimeSourceCatalogStoreService,
  type LoadedSourceCatalogToolIndexEntry,
  catalogToolCatalogEntry,
} from "./source-catalog-runtime";
import {
  invocationDescriptorFromTool,
  invokeIrTool,
} from "./ir-execution";
import { RuntimeSourceAuthMaterialService } from "./source-auth-material";
import {
  type SecretMaterialResolveContext,
} from "./secret-material-providers";
import {
  evaluateInvocationPolicy,
  type InvocationDescriptor,
} from "./invocation-policy-engine";
import { loadRuntimeLocalWorkspacePolicies } from "./policies-operations";
import {
  getRuntimeLocalWorkspaceOption,
  provideOptionalRuntimeLocalWorkspace,
  type RuntimeLocalWorkspaceState,
} from "./local-runtime-context";
import {
  LocalToolRuntimeLoaderService,
  type LocalToolRuntime,
  type LocalToolRuntimeLoaderShape,
} from "./local-tools";
import {
  SourceArtifactStore,
  makeWorkspaceStorageLayer,
  type SourceArtifactStoreShape,
  WorkspaceConfigStore,
  type WorkspaceConfigStoreShape,
  WorkspaceStateStore,
  type WorkspaceStateStoreShape,
  type WorkspaceStorageServices,
} from "./local-storage";

const asToolPath = (value: string): ToolPath => value as ToolPath;

const tokenize = (value: string): string[] =>
  value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const LOW_SIGNAL_QUERY_TOKENS = new Set([
  "a",
  "an",
  "the",
  "am",
  "as",
  "for",
  "from",
  "get",
  "i",
  "in",
  "is",
  "list",
  "me",
  "my",
  "of",
  "on",
  "or",
  "signed",
  "to",
  "who",
]);

const singularizeToken = (value: string): string =>
  value.length > 3 && value.endsWith("s") ? value.slice(0, -1) : value;

const tokenEquals = (left: string, right: string): boolean =>
  left === right || singularizeToken(left) === singularizeToken(right);

const hasTokenMatch = (
  tokens: readonly string[],
  queryToken: string,
): boolean => tokens.some((token) => tokenEquals(token, queryToken));

const hasSubstringMatch = (value: string, queryToken: string): boolean => {
  if (value.includes(queryToken)) {
    return true;
  }

  const singular = singularizeToken(queryToken);
  return singular !== queryToken && value.includes(singular);
};

const SecretResolutionContextEnvelopeSchema = Schema.Struct({
  params: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
});

const decodeSecretResolutionContextEnvelope = Schema.decodeUnknownEither(
  SecretResolutionContextEnvelopeSchema,
);
const toSecretResolutionContext = (
  value: unknown,
): SecretMaterialResolveContext | undefined => {
  const decoded = decodeSecretResolutionContextEnvelope(value);
  if (Either.isLeft(decoded) || decoded.right.params === undefined) {
    return undefined;
  }

  return {
    params: decoded.right.params,
  };
};

const queryTokenWeight = (token: string): number =>
  LOW_SIGNAL_QUERY_TOKENS.has(token) ? 0.25 : 1;

const loadWorkspaceCatalogTools = (input: {
  workspaceId: Source["workspaceId"];
  accountId: AccountId;
  sourceCatalogStore: Effect.Effect.Success<typeof RuntimeSourceCatalogStoreService>;
  includeSchemas: boolean;
}): Effect.Effect<readonly LoadedSourceCatalogToolIndexEntry[], Error, WorkspaceStorageServices> =>
  Effect.map(
    input.sourceCatalogStore.loadWorkspaceSourceCatalogToolIndex({
      workspaceId: input.workspaceId,
      actorAccountId: input.accountId,
      includeSchemas: input.includeSchemas,
    }),
    (tools) =>
      tools.filter(
        (tool) => tool.source.enabled && tool.source.status === "connected",
      ),
  );

const loadWorkspaceCatalogToolByPath = (input: {
  workspaceId: Source["workspaceId"];
  accountId: AccountId;
  sourceCatalogStore: Effect.Effect.Success<typeof RuntimeSourceCatalogStoreService>;
  path: string;
  includeSchemas: boolean;
}): Effect.Effect<LoadedSourceCatalogToolIndexEntry | null, Error, WorkspaceStorageServices> =>
  input.sourceCatalogStore.loadWorkspaceSourceCatalogToolByPath({
    workspaceId: input.workspaceId,
    path: input.path,
    actorAccountId: input.accountId,
    includeSchemas: input.includeSchemas,
  }).pipe(
    Effect.map((tool) =>
      tool && tool.source.enabled && tool.source.status === "connected"
        ? tool
        : null,
    ),
  );

const scoreCatalogTool = (
  queryTokens: readonly string[],
  tool: LoadedSourceCatalogToolIndexEntry,
): number => {
  const pathText = tool.path.toLowerCase();
  const namespaceText = tool.searchNamespace.toLowerCase();
  const toolIdText = tool.path.split(".").at(-1)?.toLowerCase() ?? "";
  const titleText = tool.capability.surface.title?.toLowerCase() ?? "";
  const descriptionText =
    tool.capability.surface.summary?.toLowerCase()
    ?? tool.capability.surface.description?.toLowerCase()
    ?? "";
  const templateText =
    tool.executable.protocol === "http"
      ? tool.executable.pathTemplate.toLowerCase()
      : tool.executable.protocol === "graphql"
        ? tool.executable.rootField.toLowerCase()
        : tool.executable.toolName.toLowerCase();

  const pathTokens = tokenize(`${tool.path} ${toolIdText}`);
  const namespaceTokens = tokenize(tool.searchNamespace);
  const titleTokens = tokenize(tool.capability.surface.title ?? "");
  const templateTokens = tokenize(templateText);

  let score = 0;
  let structuralHits = 0;
  let namespaceHits = 0;
  let pathHits = 0;

  for (const token of queryTokens) {
    const weight = queryTokenWeight(token);

    if (hasTokenMatch(pathTokens, token)) {
      score += 12 * weight;
      structuralHits += 1;
      pathHits += 1;
      continue;
    }

    if (hasTokenMatch(namespaceTokens, token)) {
      score += 11 * weight;
      structuralHits += 1;
      namespaceHits += 1;
      continue;
    }

    if (hasTokenMatch(titleTokens, token)) {
      score += 9 * weight;
      structuralHits += 1;
      continue;
    }

    if (hasTokenMatch(templateTokens, token)) {
      score += 8 * weight;
      structuralHits += 1;
      continue;
    }

    if (
      hasSubstringMatch(pathText, token) ||
      hasSubstringMatch(toolIdText, token)
    ) {
      score += 6 * weight;
      structuralHits += 1;
      pathHits += 1;
      continue;
    }

    if (hasSubstringMatch(namespaceText, token)) {
      score += 5 * weight;
      structuralHits += 1;
      namespaceHits += 1;
      continue;
    }

    if (
      hasSubstringMatch(titleText, token) ||
      hasSubstringMatch(templateText, token)
    ) {
      score += 4 * weight;
      structuralHits += 1;
      continue;
    }

    if (hasSubstringMatch(descriptionText, token)) {
      score += 0.5 * weight;
    }
  }

  const strongTokens = queryTokens.filter(
    (token) => queryTokenWeight(token) >= 1,
  );
  if (strongTokens.length >= 2) {
    for (let index = 0; index < strongTokens.length - 1; index += 1) {
      const current = strongTokens[index]!;
      const next = strongTokens[index + 1]!;
      const phrases = [
        `${current}-${next}`,
        `${current}.${next}`,
        `${current}/${next}`,
      ];

      if (
        phrases.some(
          (phrase) =>
            pathText.includes(phrase) || templateText.includes(phrase),
        )
      ) {
        score += 10;
      }
    }
  }

  if (namespaceHits > 0 && pathHits > 0) {
    score += 8;
  }

  if (structuralHits === 0 && score > 0) {
    score *= 0.25;
  }

  return score;
};

const approvalSchema = {
  type: "object",
  properties: {
    approve: {
      type: "boolean",
      description: "Whether to approve this tool execution",
    },
  },
  required: ["approve"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

const approvalMessageForInvocation = (
  descriptor: InvocationDescriptor,
): string => {
  if (descriptor.approvalLabel) {
    return `Allow ${descriptor.approvalLabel}?`;
  }

  return `Allow tool call: ${descriptor.toolPath}?`;
};

const toInvocationDescriptorFromCatalogTool = (input: {
  tool: LoadedSourceCatalogToolIndexEntry;
}): InvocationDescriptor => invocationDescriptorFromTool(input) satisfies InvocationDescriptor;

const authorizePersistedToolInvocation = (input: {
  workspaceId: Source["workspaceId"];
  accountId: AccountId;
  descriptor: InvocationDescriptor;
  args: unknown;
  source: Source;
  context?: Record<string, unknown>;
  onElicitation?: Parameters<
    typeof makeToolInvokerFromTools
  >[0]["onElicitation"];
}): Effect.Effect<void, Error, WorkspaceStorageServices> =>
  Effect.gen(function* () {
    const localWorkspacePolicies = yield* loadRuntimeLocalWorkspacePolicies(
      input.workspaceId,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    const decision = evaluateInvocationPolicy({
      descriptor: input.descriptor,
      args: input.args,
      policies: localWorkspacePolicies.policies,
      context: {
        workspaceId: input.workspaceId,
      },
    });

    if (decision.kind === "allow") {
      return;
    }

    if (decision.kind === "deny") {
      return yield* Effect.fail(new Error(decision.reason));
    }

    if (!input.onElicitation) {
      return yield* Effect.fail(
        new Error(
          `Approval required for ${input.descriptor.toolPath}, but no elicitation-capable host is available`,
        ),
      );
    }

    const interactionId =
      typeof input.context?.callId === "string" &&
      input.context.callId.length > 0
        ? `tool_execution_gate:${input.context.callId}`
        : `tool_execution_gate:${crypto.randomUUID()}`;
    const response = yield* input
      .onElicitation({
        interactionId,
        path: asToolPath(input.descriptor.toolPath),
        sourceKey: input.source.id,
        args: input.args,
        context: {
          ...(input.context ?? {}),
          interactionPurpose: "tool_execution_gate",
          interactionReason: decision.reason,
          invocationDescriptor: {
            operationKind: input.descriptor.operationKind,
            interaction: input.descriptor.interaction,
            approvalLabel: input.descriptor.approvalLabel,
            sourceId: input.source.id,
            sourceName: input.source.name,
          },
        },
        elicitation: {
          mode: "form",
          message: approvalMessageForInvocation(input.descriptor),
          requestedSchema: approvalSchema,
        },
      })
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

    if (response.action !== "accept") {
      return yield* Effect.fail(
        new Error(
          `Tool invocation not approved for ${input.descriptor.toolPath}`,
        ),
      );
    }
  });

const provideRuntimeLocalWorkspace = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState | null,
): Effect.Effect<A, E, R> =>
  provideOptionalRuntimeLocalWorkspace(effect, runtimeLocalWorkspace);

const createWorkspaceSourceCatalog = (input: {
  workspaceId: Source["workspaceId"];
  accountId: AccountId;
  sourceCatalogStore: Effect.Effect.Success<typeof RuntimeSourceCatalogStoreService>;
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState | null;
}): ToolCatalog => {
  const workspaceStorageLayer = makeWorkspaceStorageLayer({
    workspaceConfigStore: input.workspaceConfigStore,
    workspaceStateStore: input.workspaceStateStore,
    sourceArtifactStore: input.sourceArtifactStore,
  });
  const provideWorkspaceStorage = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provide(workspaceStorageLayer));

  const createSharedCatalog = (includeSchemas: boolean): Effect.Effect<ToolCatalog, Error, never> =>
    provideWorkspaceStorage(Effect.gen(function* () {
      const catalogTools = yield* loadWorkspaceCatalogTools({
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        sourceCatalogStore: input.sourceCatalogStore,
        includeSchemas,
      });

      return createToolCatalogFromEntries({
        entries: catalogTools.map((tool) =>
          catalogToolCatalogEntry({
            tool,
            score: (queryTokens) => scoreCatalogTool(queryTokens, tool),
          }),
        ),
      });
    }));

  return {
    listNamespaces: ({ limit }) =>
      provideRuntimeLocalWorkspace(
        Effect.flatMap(createSharedCatalog(false), (catalog) =>
          catalog.listNamespaces({ limit }),
        ),
        input.runtimeLocalWorkspace,
      ),

    listTools: ({ namespace, query, limit, includeSchemas = false }) =>
      provideRuntimeLocalWorkspace(
        Effect.flatMap(createSharedCatalog(includeSchemas), (catalog) =>
          catalog.listTools({
            ...(namespace !== undefined ? { namespace } : {}),
            ...(query !== undefined ? { query } : {}),
            limit,
            includeSchemas,
          }),
        ),
        input.runtimeLocalWorkspace,
      ),

    getToolByPath: ({ path, includeSchemas }) =>
      provideRuntimeLocalWorkspace(
        Effect.flatMap(createSharedCatalog(includeSchemas), (catalog) =>
          catalog.getToolByPath({ path, includeSchemas }),
        ),
        input.runtimeLocalWorkspace,
      ),

    searchTools: ({ query, namespace, limit }) =>
      provideRuntimeLocalWorkspace(
        Effect.flatMap(createSharedCatalog(false), (catalog) =>
          catalog.searchTools({
            query,
            ...(namespace !== undefined ? { namespace } : {}),
            limit,
          }),
        ),
        input.runtimeLocalWorkspace,
      ),
  } satisfies ToolCatalog;
};

const createWorkspaceToolInvoker = (input: {
  workspaceId: Source["workspaceId"];
  accountId: AccountId;
  sourceCatalogStore: Effect.Effect.Success<typeof RuntimeSourceCatalogStoreService>;
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
  sourceAuthMaterialService: Effect.Effect.Success<typeof RuntimeSourceAuthMaterialService>;
  sourceAuthService: RuntimeSourceAuthService;
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState | null;
  localToolRuntime: LocalToolRuntime;
  onElicitation?: Parameters<
    typeof makeToolInvokerFromTools
  >[0]["onElicitation"];
}): {
  catalog: ToolCatalog;
  toolInvoker: ToolInvoker;
} => {
  const workspaceStorageLayer = makeWorkspaceStorageLayer({
    workspaceConfigStore: input.workspaceConfigStore,
    workspaceStateStore: input.workspaceStateStore,
    sourceArtifactStore: input.sourceArtifactStore,
  });
  const provideWorkspaceStorage = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provide(workspaceStorageLayer));

  const executorTools = createExecutorToolMap({
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    sourceAuthService: input.sourceAuthService,
    runtimeLocalWorkspace: input.runtimeLocalWorkspace,
  });
  const sourceCatalog = createWorkspaceSourceCatalog({
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    sourceCatalogStore: input.sourceCatalogStore,
    workspaceConfigStore: input.workspaceConfigStore,
    workspaceStateStore: input.workspaceStateStore,
    sourceArtifactStore: input.sourceArtifactStore,
    runtimeLocalWorkspace: input.runtimeLocalWorkspace,
  });
  let catalog: ToolCatalog | null = null;
  const systemTools = createSystemToolMap({
    getCatalog: () => {
      if (catalog === null) {
        throw new Error("Workspace tool catalog has not been initialized");
      }

      return catalog;
    },
  });
  const authoredTools = mergeToolMaps([
    systemTools,
    executorTools,
    input.localToolRuntime.tools,
  ]);
  const authoredCatalog = createToolCatalogFromTools({
    tools: authoredTools,
  });
  catalog = mergeToolCatalogs({
    catalogs: [authoredCatalog, sourceCatalog],
  });
  const authoredToolPaths = new Set(Object.keys(authoredTools));
  const authoredInvoker = makeToolInvokerFromTools({
    tools: authoredTools,
    onElicitation: input.onElicitation,
  });

  const invokePersistedTool = (invocation: {
    path: string;
    args: unknown;
    context?: Record<string, unknown>;
  }) =>
    provideRuntimeLocalWorkspace(
      provideWorkspaceStorage(Effect.gen(function* () {
        const catalogTool = yield* loadWorkspaceCatalogToolByPath({
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          sourceCatalogStore: input.sourceCatalogStore,
          path: invocation.path,
          includeSchemas: false,
        });
        if (!catalogTool) {
          return yield* Effect.fail(
            new Error(`Unknown tool path: ${invocation.path}`),
          );
        }

        yield* authorizePersistedToolInvocation({
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          descriptor: toInvocationDescriptorFromCatalogTool({
            tool: catalogTool,
          }),
          args: invocation.args,
          source: catalogTool.source,
          context: invocation.context,
          onElicitation: input.onElicitation,
        });

        const auth = yield* input.sourceAuthMaterialService.resolve({
          source: catalogTool.source,
          actorAccountId: input.accountId,
          context: toSecretResolutionContext(invocation.context),
        });
        return yield* invokeIrTool({
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          tool: catalogTool,
          auth,
          args: invocation.args,
          onElicitation: input.onElicitation,
          context: invocation.context,
        });
      })),
      input.runtimeLocalWorkspace,
    );

  return {
    catalog,
    toolInvoker: {
      invoke: ({ path, args, context }) =>
        provideRuntimeLocalWorkspace(
          authoredToolPaths.has(path)
            ? authoredInvoker.invoke({ path, args, context })
            : invokePersistedTool({ path, args, context }),
          input.runtimeLocalWorkspace,
        ),
    },
  };
};

export const createWorkspaceExecutionEnvironmentResolver = (input: {
  sourceAuthMaterialService: Effect.Effect.Success<typeof RuntimeSourceAuthMaterialService>;
  sourceAuthService: RuntimeSourceAuthService;
  sourceCatalogStore: Effect.Effect.Success<typeof RuntimeSourceCatalogStoreService>;
  localToolRuntimeLoader: LocalToolRuntimeLoaderShape;
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
}): ResolveExecutionEnvironment =>
  ({ workspaceId, accountId, onElicitation }) =>
    Effect.gen(function* () {
      const runtimeLocalWorkspace = yield* getRuntimeLocalWorkspaceOption();
      const localToolRuntime =
        runtimeLocalWorkspace === null
          ? {
              tools: {},
              catalog: createToolCatalogFromTools({ tools: {} }),
              toolInvoker: makeToolInvokerFromTools({ tools: {} }),
              toolPaths: new Set<string>(),
            }
          : yield* input.localToolRuntimeLoader.load(runtimeLocalWorkspace.context);
      const { catalog, toolInvoker } = createWorkspaceToolInvoker({
        workspaceId,
        accountId,
        sourceCatalogStore: input.sourceCatalogStore,
        workspaceConfigStore: input.workspaceConfigStore,
        workspaceStateStore: input.workspaceStateStore,
        sourceArtifactStore: input.sourceArtifactStore,
        sourceAuthMaterialService: input.sourceAuthMaterialService,
        sourceAuthService: input.sourceAuthService,
        runtimeLocalWorkspace,
        localToolRuntime,
        onElicitation,
      });

      const executor = makeQuickJsExecutor();

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
  } = {},
) =>
  input.executionResolver
    ? Layer.succeed(RuntimeExecutionResolverService, input.executionResolver)
      : Layer.effect(
        RuntimeExecutionResolverService,
        Effect.gen(function* () {
          const sourceAuthMaterialService = yield* RuntimeSourceAuthMaterialService;
          const sourceAuthService = yield* RuntimeSourceAuthServiceTag;
          const sourceCatalogStore = yield* RuntimeSourceCatalogStoreService;
          const localToolRuntimeLoader = yield* LocalToolRuntimeLoaderService;
          const workspaceConfigStore = yield* WorkspaceConfigStore;
          const workspaceStateStore = yield* WorkspaceStateStore;
          const sourceArtifactStore = yield* SourceArtifactStore;

          return createWorkspaceExecutionEnvironmentResolver({
            sourceAuthService,
            sourceAuthMaterialService,
            sourceCatalogStore,
            localToolRuntimeLoader,
            workspaceConfigStore,
            workspaceStateStore,
            sourceArtifactStore,
          });
        }),
      );
