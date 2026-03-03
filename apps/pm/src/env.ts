import {
  defaultExecuteToolExposureMode,
  parseExecuteToolExposureMode,
} from "@executor-v2/engine";
import { type WorkspaceId } from "@executor-v2/schema";
import { configSchema, server } from "better-env/config-schema";
import * as path from "node:path";

const defaultStateRootDir = ".executor-v2/pm-state";
const defaultWorkspaceId = "ws_local" as WorkspaceId;

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const parsePort = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8788;
};

const isTruthy = (value: string | undefined): boolean => {
  const normalized = trim(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const pmEnvConfig = configSchema("PmEnvironment", {
  nodeEnv: server({ env: "NODE_ENV", optional: true }),
  port: server({ env: "PORT", optional: true }),
  workspaceId: server({
    env: "PM_WORKSPACE_ID",
    optional: true,
  }),
  stateRootDir: server({
    env: "PM_STATE_ROOT_DIR",
    optional: true,
  }),
  controlPlaneDatabaseUrl: server({
    env: "PM_CONTROL_PLANE_DATABASE_URL",
    optional: true,
  }),
  controlPlaneDataDir: server({
    env: "PM_CONTROL_PLANE_DATA_DIR",
    optional: true,
  }),
  requireToolApprovals: server({ env: "PM_REQUIRE_TOOL_APPROVALS", optional: true }),
  toolExposureMode: server({
    env: "PM_TOOL_EXPOSURE_MODE",
    optional: true,
  }),
  runtimeKind: server({
    env: "PM_RUNTIME_KIND",
    optional: true,
  }),
  localAdminFallback: server({
    env: "PM_ALLOW_LOCAL_ADMIN",
    optional: true,
  }),
  runtimeCallbackSecret: server({
    env: "CLOUDFLARE_SANDBOX_CALLBACK_SECRET",
    optional: true,
  }),
});

const readToolExposureMode = (value: string | undefined): "all_tools" | "sources_only" =>
  parseExecuteToolExposureMode(value?.trim()) ?? defaultExecuteToolExposureMode;

export type PmEnvironment = {
  nodeEnv: string;
  port: number;
  workspaceId: WorkspaceId;
  stateRootDir: string;
  controlPlaneDatabaseUrl: string | undefined;
  controlPlaneDataDir: string;
  requireToolApprovals: boolean;
  defaultToolExposureMode: "all_tools" | "sources_only";
  runtimeKind: string | undefined;
  localAdminFallbackEnabled: boolean;
  runtimeCallbackSecret: string | undefined;
};

export const readPmEnvironment = (): PmEnvironment => {
  const env = pmEnvConfig.server;
  const configuredLocalAdmin = trim(env.localAdminFallback)?.toLowerCase();
  const nodeEnv = trim(env.nodeEnv) ?? "development";
  const localAdminFallbackEnabled =
    configuredLocalAdmin === undefined
      ? nodeEnv !== "production"
      : configuredLocalAdmin === "1"
        || configuredLocalAdmin === "true"
        || configuredLocalAdmin === "yes";

  return {
    nodeEnv,
    port: parsePort(env.port),
    workspaceId: (trim(env.workspaceId) ?? defaultWorkspaceId) as WorkspaceId,
    stateRootDir: trim(env.stateRootDir) ?? defaultStateRootDir,
    controlPlaneDatabaseUrl: trim(env.controlPlaneDatabaseUrl),
    controlPlaneDataDir:
      trim(env.controlPlaneDataDir)
      ?? path.resolve(trim(env.stateRootDir) ?? defaultStateRootDir, "control-plane-pgdata"),
    requireToolApprovals: isTruthy(env.requireToolApprovals),
    defaultToolExposureMode: readToolExposureMode(env.toolExposureMode),
    runtimeKind: trim(env.runtimeKind),
    localAdminFallbackEnabled,
    runtimeCallbackSecret: trim(env.runtimeCallbackSecret),
  };
};
