import {
  defaultExecuteToolExposureMode,
  parseExecuteToolExposureMode,
  type ExecuteToolExposureMode,
} from "@executor-v2/engine";
import { configSchema, server } from "better-env/config-schema";
import { isTruthy, trim } from "./shared";

const webServerEnvConfig = configSchema("WebServerEnvironment", {
  nodeEnv: server({ env: "NODE_ENV", optional: true }),
  databaseUrl: server({ env: "DATABASE_URL", optional: true }),
  controlPlanePostgresConnectionTarget: server({
    env: "CONTROL_PLANE_POSTGRES_CONNECTION_TARGET",
    optional: true,
  }),
  pmRuntimeKind: server({ env: "PM_RUNTIME_KIND", optional: true }),
  pmRequireToolApprovals: server({ env: "PM_REQUIRE_TOOL_APPROVALS", optional: true }),
  pmToolExposureMode: server({ env: "PM_TOOL_EXPOSURE_MODE", optional: true }),
  executorPublicOrigin: server({ env: "EXECUTOR_PUBLIC_ORIGIN", optional: true }),
  vercelProjectProductionUrl: server({ env: "VERCEL_PROJECT_PRODUCTION_URL", optional: true }),
  vercelUrl: server({ env: "VERCEL_URL", optional: true }),
  workosClientId: server({ env: "WORKOS_CLIENT_ID", optional: true }),
  workosApiKey: server({ env: "WORKOS_API_KEY", optional: true }),
  workosRedirectUri: server({ env: "WORKOS_REDIRECT_URI", optional: true }),
  mcpAuthorizationServer: server({ env: "MCP_AUTHORIZATION_SERVER", optional: true }),
  mcpAuthorizationServerUrl: server({ env: "MCP_AUTHORIZATION_SERVER_URL", optional: true }),
  workosAuthkitIssuer: server({ env: "WORKOS_AUTHKIT_ISSUER", optional: true }),
  workosAuthkitDomain: server({ env: "WORKOS_AUTHKIT_DOMAIN", optional: true }),
  executorAllowLocalMcpOauth: server({
    env: "EXECUTOR_ALLOW_LOCAL_MCP_OAUTH",
    optional: true,
  }),
});

const resolveToolExposureMode = (value: string | undefined): ExecuteToolExposureMode =>
  parseExecuteToolExposureMode(trim(value)) ?? defaultExecuteToolExposureMode;

const env = webServerEnvConfig.server;

export const webServerEnvironment = {
  nodeEnv: trim(env.nodeEnv) ?? "development",
  databaseUrl: trim(env.databaseUrl),
  controlPlanePostgresConnectionTarget: trim(env.controlPlanePostgresConnectionTarget)?.toLowerCase(),
  pmRuntimeKind: trim(env.pmRuntimeKind),
  pmRequireToolApprovals: isTruthy(env.pmRequireToolApprovals),
  pmToolExposureMode: resolveToolExposureMode(env.pmToolExposureMode),
  executorPublicOrigin: trim(env.executorPublicOrigin),
  vercelProjectProductionUrl: trim(env.vercelProjectProductionUrl),
  vercelUrl: trim(env.vercelUrl),
  workosClientId: trim(env.workosClientId),
  workosApiKey: trim(env.workosApiKey),
  workosRedirectUri: trim(env.workosRedirectUri),
  mcpAuthorizationServer: trim(env.mcpAuthorizationServer),
  mcpAuthorizationServerUrl: trim(env.mcpAuthorizationServerUrl),
  workosAuthkitIssuer: trim(env.workosAuthkitIssuer),
  workosAuthkitDomain: trim(env.workosAuthkitDomain),
  executorAllowLocalMcpOauth: isTruthy(env.executorAllowLocalMcpOauth),
};
