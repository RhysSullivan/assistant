import { homedir } from "node:os";
import { join } from "node:path";

import { loadMonorepoRootEnv } from "./env";

loadMonorepoRootEnv();

export const EXECUTOR_HOME_ENV = "EXECUTOR_HOME";
export const EXECUTOR_DATA_DIR_ENV = "EXECUTOR_DATA_DIR";
export const EXECUTOR_LOCAL_DATA_DIR_ENV = "EXECUTOR_LOCAL_DATA_DIR";
export const EXECUTOR_SERVER_PID_FILE_ENV = "EXECUTOR_SERVER_PID_FILE";
export const EXECUTOR_SERVER_LOG_FILE_ENV = "EXECUTOR_SERVER_LOG_FILE";
export const EXECUTOR_WEB_ASSETS_DIR_ENV = "EXECUTOR_WEB_ASSETS_DIR";
export const EXECUTOR_TRACE_ENABLED_ENV = "EXECUTOR_TRACE_ENABLED";
export const EXECUTOR_TRACE_OTLP_ENDPOINT_ENV = "EXECUTOR_TRACE_OTLP_ENDPOINT";
export const EXECUTOR_TRACE_OTLP_HTTP_ENDPOINT_ENV = "EXECUTOR_TRACE_OTLP_HTTP_ENDPOINT";
export const EXECUTOR_TRACE_SERVICE_NAME_ENV = "EXECUTOR_TRACE_SERVICE_NAME";
export const EXECUTOR_TRACE_QUERY_BASE_URL_ENV = "EXECUTOR_TRACE_QUERY_BASE_URL";

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const home = homedir();
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const explicitExecutorHome = trim(process.env[EXECUTOR_HOME_ENV]);
const defaultLinuxDataHome = trim(process.env.XDG_DATA_HOME) ?? join(home, ".local", "share");
const defaultLinuxStateHome = trim(process.env.XDG_STATE_HOME) ?? join(home, ".local", "state");
const defaultWindowsHome = join(trim(process.env.LOCALAPPDATA) ?? join(home, "AppData", "Local"), "Executor");
const defaultMacHome = join(home, "Library", "Application Support", "Executor");
const defaultLinuxHome = join(defaultLinuxDataHome, "executor");
const legacyLinuxHome = join(defaultLinuxDataHome, "executor-v3");
const legacyWindowsHome = join(
  trim(process.env.LOCALAPPDATA) ?? join(home, "AppData", "Local"),
  "Executor-v3",
);
const legacyMacHome = join(
  home,
  "Library",
  "Application Support",
  "Executor-v3",
);

export const DEFAULT_SERVER_PORT = 8788;
export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_BASE_URL = `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;
export const DEFAULT_EXECUTOR_HOME =
  explicitExecutorHome
  ?? (isWindows ? defaultWindowsHome : isMac ? defaultMacHome : defaultLinuxHome);
export const DEFAULT_EXECUTOR_DATA_DIR =
  trim(process.env[EXECUTOR_DATA_DIR_ENV])
  ?? join(DEFAULT_EXECUTOR_HOME, "data");
export const DEFAULT_EXECUTOR_RUN_DIR = explicitExecutorHome
  ? join(DEFAULT_EXECUTOR_HOME, "run")
  : isWindows || isMac
    ? join(DEFAULT_EXECUTOR_HOME, "run")
    : join(defaultLinuxStateHome, "executor", "run");

export const DEFAULT_LOCAL_DATA_DIR =
  trim(process.env[EXECUTOR_LOCAL_DATA_DIR_ENV])
  ?? join(DEFAULT_EXECUTOR_DATA_DIR, "control-plane");

export const DEFAULT_LEGACY_LOCAL_DATA_DIRS = explicitExecutorHome
  ? []
  : [
      isWindows ? join(legacyWindowsHome, "control-plane") : null,
      isMac ? join(legacyMacHome, "control-plane") : null,
      !isWindows && !isMac ? join(legacyLinuxHome, "control-plane") : null,
    ].filter((value): value is string => value !== null);

export const DEFAULT_SERVER_PID_FILE =
  trim(process.env[EXECUTOR_SERVER_PID_FILE_ENV])
  ?? join(DEFAULT_EXECUTOR_RUN_DIR, "server.pid");
export const DEFAULT_SERVER_LOG_FILE =
  trim(process.env[EXECUTOR_SERVER_LOG_FILE_ENV])
  ?? join(DEFAULT_EXECUTOR_RUN_DIR, "server.log");

export const SERVER_START_TIMEOUT_MS = 5_000;
export const SERVER_POLL_INTERVAL_MS = 100;
