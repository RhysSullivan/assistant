export {
  mcpPlugin,
  type McpPluginExtension,
  type McpPluginOptions,
  type McpSourceConfig,
  type McpRemoteSourceConfig,
  type McpStdioSourceConfig,
  type McpProbeResult,
  type McpUpdateSourceInput,
} from "./plugin";

export {
  makeMcpStore,
  mcpSchema,
  type McpBindingStore,
  type McpSchema,
  type McpStoredSource,
} from "./binding-store";

export { McpConnectionAuth } from "./types";
