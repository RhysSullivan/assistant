import { mcpPlugin as mcpPluginEffect } from "./sdk/plugin";

export type {
  McpSourceConfig,
  McpRemoteSourceConfig,
  McpStdioSourceConfig,
  McpProbeResult,
  McpOAuthStartInput,
  McpOAuthStartResponse,
  McpOAuthCompleteInput,
  McpOAuthCompleteResponse,
} from "./sdk/plugin";

export const mcpPlugin = (options?: {}) => mcpPluginEffect(options);
