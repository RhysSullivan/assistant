import * as Effect from "effect/Effect";

import {
  type SearchProvider,
  type ToolDirectory,
  type ToolPath,
  createDynamicDiscovery,
} from "@executor-v3/codemode-core";

const asToolPath = (value: string): ToolPath => value as ToolPath;

const directory: ToolDirectory = {
  listNamespaces() {
    return Effect.succeed([
      { namespace: "source.src_api", toolCount: 6800 },
      { namespace: "source.src_mcp", toolCount: 3200 },
    ]);
  },
  listTools() {
    return Effect.succeed([{ path: asToolPath("source.src_api.github.issues.list") }]);
  },
  getByPath({ path }: { path: ToolPath; includeSchemas: boolean }) {
    return Effect.succeed({
      path,
      sourceKey: "source.src_api",
      description: "Hydrated metadata for selected path",
      inputHint: "object",
      outputHint: "object",
    });
  },
  getByPaths({ paths }: { paths: readonly ToolPath[]; includeSchemas: boolean }) {
    return Effect.succeed(
      paths.map((path) => ({
        path,
        sourceKey: "source.src_api",
        description: "Hydrated from metadata store",
        inputHint: "object",
        outputHint: "object",
      })),
    );
  },
};

const search: SearchProvider = {
  search({ limit }) {
    return Effect.succeed([
      { path: asToolPath("source.src_api.github.issues.list"), score: 0.99 },
      { path: asToolPath("source.src_api.github.issues.create"), score: 0.92 },
    ].slice(0, limit));
  },
};

export const dynamicDemo = createDynamicDiscovery({
  directory,
  search,
});
