import { Layer } from "effect";

import { GoogleDiscoveryExtensionService, GoogleDiscoveryGroup, GoogleDiscoveryHandlers } from "@executor/plugin-google-discovery/api";
import { GraphqlExtensionService, GraphqlGroup, GraphqlHandlers } from "@executor/plugin-graphql/api";
import { McpExtensionService, McpGroup, McpHandlers } from "@executor/plugin-mcp/api";
import { OpenApiExtensionService, OpenApiGroup, OpenApiHandlers } from "@executor/plugin-openapi/api";

export type FirstPartyPluginExecutor = {
  readonly openapi: unknown;
  readonly mcp: unknown;
  readonly googleDiscovery: unknown;
  readonly graphql: unknown;
};

type FirstPartyServerPlugin = {
  readonly addToApi: (api: unknown) => unknown;
  readonly handlersLayer: Layer.Layer<any, any, any>;
  readonly extensionLayer: (executor: FirstPartyPluginExecutor) => Layer.Layer<any, any, never>;
};

type ApiWithAdd = {
  readonly add: (group: unknown) => unknown;
};

const mergeLayers = <T extends Layer.Layer<any, any, any>>(layers: readonly [T, ...Array<T>]) => {
  const [first, ...rest] = layers;
  return rest.reduce((current, layer) => Layer.merge(current, layer) as T, first);
};

const firstPartyServerPlugins: readonly FirstPartyServerPlugin[] = [
  {
    addToApi: (api) => (api as ApiWithAdd).add(OpenApiGroup),
    handlersLayer: OpenApiHandlers,
    extensionLayer: (executor) =>
      Layer.succeed(OpenApiExtensionService, executor.openapi as never),
  },
  {
    addToApi: (api) => (api as ApiWithAdd).add(McpGroup),
    handlersLayer: McpHandlers,
    extensionLayer: (executor) => Layer.succeed(McpExtensionService, executor.mcp as never),
  },
  {
    addToApi: (api) => (api as ApiWithAdd).add(GoogleDiscoveryGroup),
    handlersLayer: GoogleDiscoveryHandlers,
    extensionLayer: (executor) =>
      Layer.succeed(GoogleDiscoveryExtensionService, executor.googleDiscovery as never),
  },
  {
    addToApi: (api) => (api as ApiWithAdd).add(GraphqlGroup),
    handlersLayer: GraphqlHandlers,
    extensionLayer: (executor) =>
      Layer.succeed(GraphqlExtensionService, executor.graphql as never),
  },
];

export const addFirstPartyPluginGroups = <T>(api: T) =>
  firstPartyServerPlugins.reduce(
    (current, plugin) => plugin.addToApi(current) as T,
    api,
  );

export const FirstPartyPluginHandlers = mergeLayers(
  firstPartyServerPlugins.map((plugin) => plugin.handlersLayer) as [
    Layer.Layer<any, any, any>,
    ...Array<Layer.Layer<any, any, any>>,
  ],
);

export const createFirstPartyPluginExtensions = (executor: FirstPartyPluginExecutor) =>
  mergeLayers(
    firstPartyServerPlugins.map((plugin) => plugin.extensionLayer(executor)) as [
      Layer.Layer<any, any, never>,
      ...Array<Layer.Layer<any, any, never>>,
    ],
  );
