import { googleDiscoverySourcePlugin } from "@executor/plugin-google-discovery/react";
import { graphqlSourcePlugin } from "@executor/plugin-graphql/react";
import { createMcpSourcePlugin } from "@executor/plugin-mcp/react";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";

const mcpSourcePlugin = createMcpSourcePlugin({ allowStdio: true });

export const sourcePlugins = [
  openApiSourcePlugin,
  mcpSourcePlugin,
  googleDiscoverySourcePlugin,
  graphqlSourcePlugin,
];
