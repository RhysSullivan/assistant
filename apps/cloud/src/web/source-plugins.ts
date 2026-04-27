import { graphqlSourcePlugin } from "@executor/plugin-graphql/react";
import { mcpSourcePlugin } from "@executor/plugin-mcp/react";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";

export const sourcePlugins = [openApiSourcePlugin, mcpSourcePlugin, graphqlSourcePlugin];
