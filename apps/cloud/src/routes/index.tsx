import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "@executor/react/pages/sources";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";
import { mcpSourcePlugin } from "@executor/plugin-mcp/react";
import { graphqlSourcePlugin } from "@executor/plugin-graphql/react";

const sourcePlugins = [openApiSourcePlugin, mcpSourcePlugin, graphqlSourcePlugin];

export const Route = createFileRoute("/")({
  component: () => <SourcesPage sourcePlugins={sourcePlugins} />,
});
