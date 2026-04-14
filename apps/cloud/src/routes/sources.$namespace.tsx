import { createFileRoute } from "@tanstack/react-router";
import { SourceDetailPage } from "@executor/react/pages/source-detail";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";
import { mcpSourcePlugin } from "@executor/plugin-mcp/react";
import { graphqlSourcePlugin } from "@executor/plugin-graphql/react";

const sourcePlugins = [openApiSourcePlugin, mcpSourcePlugin, graphqlSourcePlugin];

export const Route = createFileRoute("/sources/$namespace")({
  component: () => {
    const { namespace } = Route.useParams();
    return <SourceDetailPage namespace={namespace} sourcePlugins={sourcePlugins} />;
  },
});
