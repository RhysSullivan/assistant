import { createFileRoute } from "@tanstack/react-router";
import { SourceDetailPage } from "@executor-js/react/pages/source-detail";
import { openApiSourcePlugin } from "@executor-js/plugin-openapi/react";
import { createMcpSourcePlugin } from "@executor-js/plugin-mcp/react";

const mcpSourcePlugin = createMcpSourcePlugin({ allowStdio: true });
import { googleDiscoverySourcePlugin } from "@executor-js/plugin-google-discovery/react";
import { graphqlSourcePlugin } from "@executor-js/plugin-graphql/react";

const sourcePlugins = [
  openApiSourcePlugin,
  mcpSourcePlugin,
  googleDiscoverySourcePlugin,
  graphqlSourcePlugin,
];

export const Route = createFileRoute("/sources/$namespace")({
  component: () => {
    const { namespace } = Route.useParams();
    return <SourceDetailPage namespace={namespace} sourcePlugins={sourcePlugins} />;
  },
});
