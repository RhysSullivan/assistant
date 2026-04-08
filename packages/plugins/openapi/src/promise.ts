import { openApiPlugin as openApiPluginEffect } from "./sdk/plugin";

export type { OpenApiSpecConfig } from "./sdk/plugin";

export const openApiPlugin = (options?: {}) => openApiPluginEffect(options);
