import * as Effect from "effect/Effect";

export type ToolPath = string & { readonly __toolPath: unique symbol };

export type ToolMetadata = {
  interaction?: "auto" | "required";
  inputHint?: string;
  outputHint?: string;
  inputSchemaJson?: string;
  outputSchemaJson?: string;
  refHintKeys?: readonly string[];
  sourceKey?: string;
};

export type ExecutableTool = {
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  parameters?: unknown;
  execute?: (...args: any[]) => unknown;
};

export type ToolDefinition = {
  tool: ExecutableTool;
  metadata?: ToolMetadata;
};

export type ToolInput = ExecutableTool | ToolDefinition;

export type ToolMap = Record<string, ToolInput>;

type ResolvedTool = {
  path: ToolPath;
  tool: ExecutableTool;
  metadata?: ToolMetadata;
};

export type ToolDescriptor = {
  path: ToolPath;
  sourceKey: string;
  description?: string;
  interaction?: "auto" | "required";
  inputHint?: string;
  outputHint?: string;
  inputSchemaJson?: string;
  outputSchemaJson?: string;
  refHintKeys?: readonly string[];
};

export type SearchHit = {
  path: ToolPath;
  score: number;
};

export interface SearchProvider {
  search(input: {
    query: string;
    limit: number;
  }): Effect.Effect<readonly SearchHit[], unknown>;
}

export interface ToolDirectory {
  listNamespaces(input: {
    limit: number;
  }): Effect.Effect<readonly { namespace: string; toolCount: number }[], unknown>;

  listTools(input: {
    namespace?: string;
    query?: string;
    limit: number;
  }): Effect.Effect<readonly { path: ToolPath }[], unknown>;

  getByPath(input: {
    path: ToolPath;
    includeSchemas: boolean;
  }): Effect.Effect<ToolDescriptor | null, unknown>;

  getByPaths(input: {
    paths: readonly ToolPath[];
    includeSchemas: boolean;
  }): Effect.Effect<readonly ToolDescriptor[], unknown>;
}

export type CatalogPrimitive = {
  namespaces(input: {
    limit?: number;
  }): Effect.Effect<
    { namespaces: readonly { namespace: string; toolCount: number }[] },
    unknown
  >;
  tools(input: {
    namespace?: string;
    query?: string;
    limit?: number;
  }): Effect.Effect<{ results: readonly { path: ToolPath }[] }, unknown>;
};

export type DescribePrimitive = {
  tool(input: {
    path: ToolPath;
    includeSchemas?: boolean;
  }): Effect.Effect<ToolDescriptor | null, unknown>;
};

export type DiscoverPrimitive = {
  run(input: {
    query: string;
    limit?: number;
    includeSchemas?: boolean;
  }): Effect.Effect<
    {
      bestPath: ToolPath | null;
      results: readonly (Record<string, unknown> & {
        path: ToolPath;
        score: number;
      })[];
      total: number;
    },
    unknown
  >;
};

export type DiscoveryPrimitives = {
  catalog?: CatalogPrimitive;
  describe?: DescribePrimitive;
  discover?: DiscoverPrimitive;
};

export type ExecuteResult = {
  result: unknown;
  error?: string;
  logs?: string[];
};

export type ToolInvocationInput = {
  path: string;
  args: unknown;
};

export interface ToolInvoker {
  invoke(input: ToolInvocationInput): Effect.Effect<unknown, unknown>;
}

export interface CodeExecutor {
  execute(
    code: string,
    toolInvoker: ToolInvoker,
  ): Effect.Effect<ExecuteResult, unknown>;
}

export type CodeToolOutput = {
  code: string;
  result: unknown;
  logs?: string[];
};

const asToolPath = (value: string): ToolPath => value as ToolPath;

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

export function wrapTool(input: {
  tool: ExecutableTool;
  metadata?: ToolMetadata;
}): ToolDefinition {
  return {
    tool: input.tool,
    metadata: input.metadata,
  };
}

export const toTool = wrapTool;
export const toExecutorTool = wrapTool;

const isToolDefinition = (value: ToolInput): value is ToolDefinition =>
  typeof value === "object" && value !== null && "tool" in value;

const stringifySchema = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const inferHintFromSchemaJson = (
  schemaJson: string | undefined,
  fallback: string,
): string => {
  if (!schemaJson) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(schemaJson) as Record<string, unknown>;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    if (title.length > 0) {
      return title;
    }

    if (parsed.type === "object") {
      const properties =
        parsed.properties &&
        typeof parsed.properties === "object" &&
        !Array.isArray(parsed.properties)
          ? Object.keys(parsed.properties as Record<string, unknown>)
          : [];
      if (properties.length > 0) {
        const shown = properties.slice(0, 3).join(", ");
        return properties.length <= 3
          ? `object { ${shown} }`
          : `object { ${shown}, ... }`;
      }
      return "object";
    }

    if (parsed.type === "array") {
      return "array";
    }

    if (typeof parsed.type === "string") {
      return parsed.type;
    }
  } catch {
    // Ignore malformed schema and fall back.
  }

  return fallback;
};

export function createToolsFromRecord(input: {
  tools: Record<string, ExecutableTool>;
  sourceKey?: string;
}): ToolMap {
  const { tools, sourceKey = "in_memory.tools" } = input;

  return Object.fromEntries(
    Object.entries(tools)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, tool]) => [
        path,
        wrapTool({
          tool,
          metadata: { sourceKey },
        }),
      ]),
  ) as ToolMap;
}

const resolveToolsFromMap = (input: {
  tools: ToolMap;
  sourceKey?: string;
}): ResolvedTool[] => {
  const defaultSourceKey = input.sourceKey ?? "in_memory.tools";

  return Object.entries(input.tools)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => {
      const entry = isToolDefinition(value) ? value : { tool: value };
      const metadata = entry.metadata
        ? {
            sourceKey: defaultSourceKey,
            ...entry.metadata,
          }
        : { sourceKey: defaultSourceKey };

      return {
        path: asToolPath(path),
        tool: entry.tool,
        metadata,
      } satisfies ResolvedTool;
    });
};

export function toolDescriptorsFromTools(input: {
  tools: ToolMap;
  sourceKey?: string;
}): ToolDescriptor[] {
  const resolvedTools = resolveToolsFromMap({
    tools: input.tools,
    sourceKey: input.sourceKey,
  });

  return resolvedTools.map((entry) => {
    const metadata = entry.metadata;
    const definition = entry.tool;
    const inputSchemaJson =
      metadata?.inputSchemaJson
      ?? stringifySchema(definition.inputSchema)
      ?? stringifySchema(definition.parameters);
    const outputSchemaJson =
      metadata?.outputSchemaJson
      ?? stringifySchema(definition.outputSchema);

    return {
      path: entry.path,
      sourceKey: metadata?.sourceKey ?? "in_memory.tools",
      description: definition.description,
      interaction: metadata?.interaction,
      inputHint:
        metadata?.inputHint ?? inferHintFromSchemaJson(inputSchemaJson, "input"),
      outputHint:
        metadata?.outputHint ?? inferHintFromSchemaJson(outputSchemaJson, "output"),
      inputSchemaJson,
      outputSchemaJson,
      refHintKeys: metadata?.refHintKeys,
    } satisfies ToolDescriptor;
  });
}

export function createStaticDiscoveryFromTools(input: {
  tools: ToolMap;
  sourceKey?: string;
}): {
  preloadedTools: ToolDescriptor[];
  primitives: DiscoveryPrimitives;
  executeDescription: string;
} {
  const preloadedTools = toolDescriptorsFromTools({
    tools: input.tools,
    sourceKey: input.sourceKey,
  });
  const primitives = createDiscoveryPrimitives({});

  return {
    preloadedTools,
    primitives,
    executeDescription: buildExecuteDescription({
      preloadedTools,
      primitives,
    }),
  };
}

export const makeToolInvokerFromTools = (input: {
  tools: ToolMap;
  sourceKey?: string;
}): ToolInvoker => {
  const resolvedTools = resolveToolsFromMap({
    tools: input.tools,
    sourceKey: input.sourceKey,
  });
  const byPath = new Map(resolvedTools.map((entry) => [entry.path as string, entry]));

  return {
    invoke: ({ path, args }) =>
      Effect.gen(function* () {
        const entry = byPath.get(path);
        if (!entry) {
          return yield* Effect.fail(new Error(`Unknown tool path: ${path}`));
        }

        const execute = entry.tool.execute;
        if (!execute) {
          return yield* Effect.fail(
            new Error(`Tool has no execute function: ${path}`),
          );
        }

        return yield* Effect.tryPromise({
          try: () => Promise.resolve(execute(args)),
          catch: toError,
        });
      }),
  };
};

export const executeCodeWithTools = (input: {
  code: string;
  executor: CodeExecutor;
  tools?: ToolMap;
  sourceKey?: string;
  toolInvoker?: ToolInvoker;
}): Effect.Effect<CodeToolOutput, Error> =>
  Effect.gen(function* () {
    const toolInvoker = input.toolInvoker
      ?? (input.tools
        ? makeToolInvokerFromTools({
            tools: input.tools,
            sourceKey: input.sourceKey,
          })
        : null);

    if (!toolInvoker) {
      return yield* Effect.fail(
        new Error("executeCodeWithTools requires either tools or toolInvoker"),
      );
    }

    const result = yield* input.executor.execute(input.code, toolInvoker);
    if (result.error) {
      return yield* Effect.fail(new Error(result.error));
    }

    return {
      code: input.code,
      result: result.result,
      logs: result.logs,
    } satisfies CodeToolOutput;
  }).pipe(Effect.mapError(toError));

export function createDynamicDiscovery(input: {
  directory: ToolDirectory;
  search?: SearchProvider;
  preloadedTools?: readonly ToolDescriptor[];
}): {
  preloadedTools: readonly ToolDescriptor[];
  primitives: DiscoveryPrimitives;
  executeDescription: string;
} {
  const preloadedTools = input.preloadedTools ?? [];
  const primitives = createDiscoveryPrimitives({
    directory: input.directory,
    search: input.search,
  });

  return {
    preloadedTools,
    primitives,
    executeDescription: buildExecuteDescription({
      preloadedTools,
      primitives,
    }),
  };
}

export function createDiscoveryPrimitives(input: {
  directory?: ToolDirectory;
  search?: SearchProvider;
}): DiscoveryPrimitives {
  const { directory, search } = input;

  const catalog: CatalogPrimitive | undefined = directory
    ? {
        namespaces: ({ limit = 200 }) =>
          directory.listNamespaces({ limit }).pipe(
            Effect.map((namespaces) => ({ namespaces })),
          ),
        tools: ({ namespace, query, limit = 200 }) =>
          directory.listTools({ namespace, query, limit }).pipe(
            Effect.map((results) => ({ results })),
          ),
      }
    : undefined;

  const describe: DescribePrimitive | undefined = directory
    ? {
        tool: ({ path, includeSchemas = false }) =>
          directory.getByPath({ path, includeSchemas }),
      }
    : undefined;

  const discover: DiscoverPrimitive | undefined =
    directory && search
      ? {
          run: ({ query, limit = 12, includeSchemas = false }) =>
            Effect.gen(function* () {
              const hits = yield* search.search({ query, limit });
              if (hits.length === 0) {
                return {
                  bestPath: null,
                  results: [],
                  total: 0,
                };
              }

              const descriptors = yield* directory.getByPaths({
                paths: hits.map((hit) => hit.path),
                includeSchemas,
              });

              const byPath = new Map(
                descriptors.map((descriptor) => [descriptor.path, descriptor]),
              );
              const hydrated = hits
                .map((hit) => {
                  const descriptor = byPath.get(hit.path);
                  if (!descriptor) {
                    return null;
                  }

                  return {
                    path: descriptor.path,
                    score: hit.score,
                    description: descriptor.description,
                    interaction: descriptor.interaction ?? "auto",
                    inputHint: descriptor.inputHint,
                    outputHint: descriptor.outputHint,
                    ...(includeSchemas
                      ? {
                          inputSchemaJson: descriptor.inputSchemaJson,
                          outputSchemaJson: descriptor.outputSchemaJson,
                          refHintKeys: descriptor.refHintKeys,
                        }
                      : {}),
                  };
                })
                .filter(Boolean) as Array<
                Record<string, unknown> & { path: ToolPath; score: number }
              >;

              return {
                bestPath: hydrated[0]?.path ?? null,
                results: hydrated,
                total: hydrated.length,
              };
            }),
        }
      : undefined;

  return { catalog, describe, discover };
}

export function buildExecuteDescription(input: {
  preloadedTools: readonly ToolDescriptor[];
  primitives: DiscoveryPrimitives;
}): string {
  const { preloadedTools, primitives } = input;
  const hasCatalog = Boolean(primitives.catalog);
  const hasDescribe = Boolean(primitives.describe);
  const hasDiscover = Boolean(primitives.discover);

  if (!hasCatalog && !hasDescribe && !hasDiscover) {
    return [
      "Execute TypeScript in sandbox; call tools directly.",
      "Available tool paths:",
      ...preloadedTools.map((tool) => `- ${tool.path}`),
      "Do not use fetch; use tools.* only.",
    ].join("\n");
  }

  return [
    "Execute TypeScript in sandbox; call tools via helper workflow.",
    "Workflow:",
    hasCatalog
      ? "1) const namespaces = await tools.catalog.namespaces({ limit: 200 });"
      : "",
    hasDiscover
      ? '2) const matches = await tools.discover.run({ query: "<intent>", limit: 12 });'
      : '2) const toolsList = await tools.catalog.tools({ query: "<intent>", limit: 50 });',
    hasDescribe
      ? "3) const details = await tools.describe.tool({ path, includeSchemas: true });"
      : "",
    "4) Call selected tools.<path>(input).",
    "Do not use fetch; use tools.* only.",
  ]
    .filter(Boolean)
    .join("\n");
}
