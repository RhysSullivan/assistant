export {
  ExecutorFileConfig,
  SourceConfig,
  OpenApiSourceConfig,
  GraphqlSourceConfig,
  McpRemoteSourceConfig,
  McpStdioSourceConfig,
  McpAuthConfig,
  SecretMetadata,
  ConfigHeaderValue,
  SECRET_REF_PREFIX,
} from "./schema";

export { loadConfig, ConfigParseError } from "./load";

export {
  addSourceToConfig,
  removeSourceFromConfig,
  writeConfig,
  addSecretToConfig,
  removeSecretFromConfig,
} from "./write";

export type { ConfigFileSink, ConfigFileSinkOptions } from "./sink";
export {
  makeFileConfigSink,
  headerToConfigValue,
  headersToConfigValues,
} from "./sink";
