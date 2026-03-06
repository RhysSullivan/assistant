import * as Effect from "effect/Effect";

import { toolDescriptorsFromTools } from "./tool-map";
import type {
  CatalogPrimitive,
  DescribePrimitive,
  DiscoverPrimitive,
  DiscoveryPrimitives,
  SearchProvider,
  ToolDescriptor,
  ToolDirectory,
  ToolMap,
  ToolPath,
} from "./types";

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

export function createDynamicDiscovery(input: {
  directory: ToolDirectory;
  search?: SearchProvider;
}): {
  primitives: DiscoveryPrimitives;
  executeDescription: string;
} {
  const primitives = createDiscoveryPrimitives({
    directory: input.directory,
    search: input.search,
  });

  return {
    primitives,
    executeDescription: buildDynamicExecuteDescription({ primitives }),
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

  return buildDynamicExecuteDescription({ primitives });
}

export function buildDynamicExecuteDescription(input: {
  primitives: DiscoveryPrimitives;
}): string {
  const { primitives } = input;
  const hasCatalog = Boolean(primitives.catalog);
  const hasDescribe = Boolean(primitives.describe);
  const hasDiscover = Boolean(primitives.discover);

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
