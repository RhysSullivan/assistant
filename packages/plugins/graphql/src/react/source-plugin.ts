import { lazy } from "react";
import type { SourcePlugin } from "@executor/react";
import { graphqlPresets } from "../sdk/presets";

export const graphqlSourcePlugin: SourcePlugin = {
  key: "graphql",
  label: "GraphQL",
  add: lazy(() => import("./AddGraphqlSource")),
  edit: lazy(() => import("./EditGraphqlSource")),
  summary: lazy(() => import("./GraphqlSourceSummary")),
  presets: graphqlPresets,
};
