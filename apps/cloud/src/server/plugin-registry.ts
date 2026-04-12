import {
  addFirstPartyPluginGroups,
  createFirstPartyPluginExtensions,
  FirstPartyPluginHandlers,
} from "@executor/host-plugins/server";
import { googleDiscoveryPlugin, makeKvBindingStore as makeKvGoogleDiscoveryBindingStore } from "@executor/plugin-google-discovery";
import { graphqlPlugin, makeKvOperationStore as makeKvGraphqlOperationStore } from "@executor/plugin-graphql";
import { mcpPlugin, makeKvBindingStore } from "@executor/plugin-mcp";
import { openApiPlugin, makeKvOperationStore } from "@executor/plugin-openapi";
import type { Kv } from "@executor/sdk";

export const createCloudRuntimePlugins = (kv: Kv) =>
  [
    openApiPlugin({
      operationStore: makeKvOperationStore(kv, "openapi"),
    }),
    mcpPlugin({
      bindingStore: makeKvBindingStore(kv, "mcp"),
    }),
    googleDiscoveryPlugin({
      bindingStore: makeKvGoogleDiscoveryBindingStore(kv, "google-discovery"),
    }),
    graphqlPlugin({
      operationStore: makeKvGraphqlOperationStore(kv, "graphql"),
    }),
  ] as const;

export const addCloudPluginGroups = addFirstPartyPluginGroups;

export const CloudPluginHandlers = FirstPartyPluginHandlers;

export const createCloudPluginExtensions = createFirstPartyPluginExtensions;
