import { Schema } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { SourcesAddPage } from "@executor-js/react/pages/sources-add";
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

const SearchParams = Schema.toStandardSchemaV1(
  Schema.Struct({
    url: Schema.optional(Schema.String),
    preset: Schema.optional(Schema.String),
  }),
);

export const Route = createFileRoute("/sources/add/$pluginKey")({
  validateSearch: SearchParams,
  component: () => {
    const { pluginKey } = Route.useParams();
    const { url, preset } = Route.useSearch();
    return (
      <SourcesAddPage
        pluginKey={pluginKey}
        url={url}
        preset={preset}
        sourcePlugins={sourcePlugins}
      />
    );
  },
});
