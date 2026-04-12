import type { SourcePlugin } from "@executor/react/plugins/source-plugin";
import { googleDiscoverySourcePlugin } from "@executor/plugin-google-discovery/react";
import { graphqlSourcePlugin } from "@executor/plugin-graphql/react";
import { mcpSourcePlugin } from "@executor/plugin-mcp/react";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";

export const firstPartySourcePlugins = [
  openApiSourcePlugin,
  mcpSourcePlugin,
  googleDiscoverySourcePlugin,
  graphqlSourcePlugin,
] as const satisfies readonly SourcePlugin[];
