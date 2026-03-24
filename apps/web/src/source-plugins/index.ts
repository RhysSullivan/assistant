import {
  GoogleDiscoveryReactPlugin,
} from "@executor/plugin-google-discovery-react";
import {
  GraphqlReactPlugin,
} from "@executor/plugin-graphql-react";
import {
  McpReactPlugin,
} from "@executor/plugin-mcp-react";
import {
  OpenApiReactPlugin,
} from "@executor/plugin-openapi-react";
import type {
  ExecutorFrontendPlugin,
  FrontendSourceTypeDefinition,
} from "./types";

const frontendPlugins = [
  McpReactPlugin,
  GraphqlReactPlugin,
  GoogleDiscoveryReactPlugin,
  OpenApiReactPlugin,
] as const satisfies readonly ExecutorFrontendPlugin[];

const sourceTypeDefinitions = new Map<string, FrontendSourceTypeDefinition>();

for (const plugin of frontendPlugins) {
  plugin.register({
    sources: {
      registerType(definition) {
        sourceTypeDefinitions.set(definition.kind, definition);
      },
    },
  });
}

export const registeredSourceFrontendTypes = [...sourceTypeDefinitions.values()];

export const getSourceFrontendType = (kind: string) =>
  sourceTypeDefinitions.get(kind) ?? null;

export const getDefaultSourceFrontendType = () =>
  registeredSourceFrontendTypes[0] ?? null;
