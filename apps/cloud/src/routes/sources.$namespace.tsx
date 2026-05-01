import { createFileRoute } from "@tanstack/react-router";
import { SourceDetailPage } from "@executor-js/react/pages/source-detail";
import { openApiSourcePlugin } from "@executor-js/plugin-openapi/react";
import { mcpSourcePlugin } from "@executor-js/plugin-mcp/react";
import { graphqlSourcePlugin } from "@executor-js/plugin-graphql/react";

const sourcePlugins = [openApiSourcePlugin, mcpSourcePlugin, graphqlSourcePlugin];

export const Route = createFileRoute("/sources/$namespace")({
  component: () => {
    const { namespace } = Route.useParams();
    return <SourceDetailPage namespace={namespace} sourcePlugins={sourcePlugins} />;
  },
});
