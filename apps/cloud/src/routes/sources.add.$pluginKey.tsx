import { Schema } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { SourcesAddPage } from "@executor-js/react/pages/sources-add";
import { openApiSourcePlugin } from "@executor-js/plugin-openapi/react";
import { mcpSourcePlugin } from "@executor-js/plugin-mcp/react";
import { graphqlSourcePlugin } from "@executor-js/plugin-graphql/react";

const sourcePlugins = [openApiSourcePlugin, mcpSourcePlugin, graphqlSourcePlugin];

const SearchParams = Schema.toStandardSchemaV1(
  Schema.Struct({
    url: Schema.optional(Schema.String),
    preset: Schema.optional(Schema.String),
    namespace: Schema.optional(Schema.String),
  }),
);

export const Route = createFileRoute("/sources/add/$pluginKey")({
  validateSearch: SearchParams,
  component: () => {
    const { pluginKey } = Route.useParams();
    const { url, preset, namespace } = Route.useSearch();
    return (
      <SourcesAddPage
        pluginKey={pluginKey}
        url={url}
        preset={preset}
        namespace={namespace}
        sourcePlugins={sourcePlugins}
      />
    );
  },
});
