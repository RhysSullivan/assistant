import type { SourceCatalogSyncResult } from "@executor/source-core";
import type {
  Source,
  SourceCatalogKind,
} from "@executor/source-core";
import type { ExecutorEffect } from "./executor-effect";
import type { Source as ExecutorSource } from "./schema";
import type {
  SourceInvokeInput,
  SourceInvokeResult,
  SourceSyncInput,
} from "@executor/source-core";
import * as Effect from "effect/Effect";

export type ExecutorSdkPlugin<
  TKey extends string = string,
  TExtension extends object = {},
> = {
  key: TKey;
  sources?: readonly SourcePluginRuntime[];
  extendExecutor?: (input: {
    executor: ExecutorEffect & Record<string, unknown>;
    host: ExecutorSdkPluginHost;
  }) => TExtension;
};

export type ExecutorSdkPluginHost = {
  sources: {
    create: (input: {
      source: Omit<
        ExecutorSource,
        "id" | "scopeId" | "createdAt" | "updatedAt"
      >;
    }) => Effect.Effect<ExecutorSource, Error, never>;
    get: (sourceId: ExecutorSource["id"]) => Effect.Effect<ExecutorSource, Error, never>;
    save: (source: ExecutorSource) => Effect.Effect<ExecutorSource, Error, never>;
    refreshCatalog: (
      sourceId: ExecutorSource["id"],
    ) => Effect.Effect<ExecutorSource, Error, never>;
    remove: (sourceId: ExecutorSource["id"]) => Effect.Effect<boolean, Error, never>;
  };
};

export type ExecutorSdkPluginExtensions<
  TPlugins extends readonly ExecutorSdkPlugin<any, any>[],
> = {
  [TPlugin in TPlugins[number] as TPlugin["key"]]:
    TPlugin extends ExecutorSdkPlugin<any, infer TExtension>
      ? TExtension
      : never;
};

export type SourcePluginRuntime = {
  kind: string;
  displayName: string;
  catalogKind: SourceCatalogKind;
  catalogIdentity?: (input: {
    source: Source;
  }) => Record<string, unknown>;
  getIrModel: (
    input: SourceSyncInput,
  ) => Effect.Effect<SourceCatalogSyncResult, Error, never>;
  invoke: (
    input: SourceInvokeInput,
  ) => Effect.Effect<SourceInvokeResult, Error, never>;
};

export const registerExecutorSdkPlugins = (
  plugins: readonly ExecutorSdkPlugin[],
) => {
  const sourcePlugins = new Map<string, SourcePluginRuntime>();

  for (const plugin of plugins) {
    for (const source of plugin.sources ?? []) {
      sourcePlugins.set(source.kind, source);
    }
  }

  const getSourcePlugin = (kind: string) => {
    const definition = sourcePlugins.get(kind);
    if (!definition) {
      throw new Error(`Unsupported source plugin: ${kind}`);
    }

    return definition;
  };

  const getSourcePluginForSource = (source: Pick<Source, "kind">) =>
    getSourcePlugin(source.kind);

  return {
    plugins,
    sourcePlugins: [...sourcePlugins.values()],
    getSourcePlugin,
    getSourcePluginForSource,
    sourcePluginCatalogKind: (kind: string): SourceCatalogKind =>
      getSourcePlugin(kind).catalogKind,
    isInternalSourcePluginKind: (kind: string): boolean =>
      getSourcePlugin(kind).catalogKind === "internal",
  };
};
