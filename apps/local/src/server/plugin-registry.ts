import { Layer } from "effect";
import { NodeFileSystem } from "@effect/platform-node";

import { CoreExecutorApi } from "@executor/api";
import {
  addFirstPartyPluginGroups,
  createFirstPartyPluginExtensions,
  FirstPartyPluginHandlers,
} from "@executor/host-plugins/server";
import { googleDiscoveryPlugin, makeKvBindingStore as makeKvGoogleDiscoveryBindingStore } from "@executor/plugin-google-discovery";
import { graphqlPlugin, makeKvOperationStore as makeKvGraphqlOperationStore, withConfigFile as withGraphqlConfigFile } from "@executor/plugin-graphql";
import { keychainPlugin } from "@executor/plugin-keychain";
import { mcpPlugin, makeKvBindingStore, withConfigFile as withMcpConfigFile } from "@executor/plugin-mcp";
import { onepasswordPlugin } from "@executor/plugin-onepassword";
import { OnePasswordExtensionService, OnePasswordGroup, OnePasswordHandlers } from "@executor/plugin-onepassword/api";
import { openApiPlugin, makeKvOperationStore, withConfigFile as withOpenApiConfigFile } from "@executor/plugin-openapi";
import { fileSecretsPlugin } from "@executor/plugin-file-secrets";
import { scopeKv } from "@executor/sdk";
import { makeScopedKv } from "@executor/storage-file";

type LocalRuntimePluginFactoryOptions = {
  readonly scopedKv: ReturnType<typeof makeScopedKv>;
  readonly configPath: string;
  readonly fsLayer: typeof NodeFileSystem.layer;
};

const mergeLayers = <T extends Layer.Layer<any, any, any>>(layers: readonly [T, ...Array<T>]) => {
  const [first, ...rest] = layers;
  return rest.reduce((current, layer) => Layer.merge(current, layer) as T, first);
};

export const createLocalRuntimePlugins = (options: LocalRuntimePluginFactoryOptions) =>
  [
    openApiPlugin({
      operationStore: withOpenApiConfigFile(
        makeKvOperationStore(options.scopedKv, "openapi"),
        options.configPath,
        options.fsLayer,
      ),
    }),
    mcpPlugin({
      bindingStore: withMcpConfigFile(
        makeKvBindingStore(options.scopedKv, "mcp"),
        options.configPath,
        options.fsLayer,
      ),
    }),
    googleDiscoveryPlugin({
      bindingStore: makeKvGoogleDiscoveryBindingStore(options.scopedKv, "google-discovery"),
    }),
    graphqlPlugin({
      operationStore: withGraphqlConfigFile(
        makeKvGraphqlOperationStore(options.scopedKv, "graphql"),
        options.configPath,
        options.fsLayer,
      ),
    }),
    keychainPlugin(),
    fileSecretsPlugin(),
    onepasswordPlugin({
      kv: scopeKv(options.scopedKv, "onepassword"),
    }),
  ] as const;

export const LocalApi = addFirstPartyPluginGroups(CoreExecutorApi).add(OnePasswordGroup);

export const LocalPluginHandlers = mergeLayers(
  [FirstPartyPluginHandlers, OnePasswordHandlers] as const,
);

export const createLocalPluginExtensions = (
  executor: Parameters<typeof createFirstPartyPluginExtensions>[0] & { readonly onepassword: unknown },
) =>
  mergeLayers(
    [
      createFirstPartyPluginExtensions(executor),
      Layer.succeed(OnePasswordExtensionService, executor.onepassword as never),
    ] as const,
  );
