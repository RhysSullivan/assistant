import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "@executor-js/react/pages/sources";
import { openApiSourcePlugin } from "@executor-js/plugin-openapi/react";
import { mcpSourcePlugin } from "@executor-js/plugin-mcp/react";
import { graphqlSourcePlugin } from "@executor-js/plugin-graphql/react";

const sourcePlugins = [openApiSourcePlugin, mcpSourcePlugin, graphqlSourcePlugin];

export const Route = createFileRoute("/")({
  component: () => <SourcesPage sourcePlugins={sourcePlugins} />,
});
