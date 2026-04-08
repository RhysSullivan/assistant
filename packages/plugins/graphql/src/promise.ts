import { graphqlPlugin as graphqlPluginEffect } from "./sdk/plugin";

export type { GraphqlSourceConfig } from "./sdk/plugin";
export type { HeaderValue } from "./sdk/types";

export const graphqlPlugin = (options?: {}) => graphqlPluginEffect(options);
