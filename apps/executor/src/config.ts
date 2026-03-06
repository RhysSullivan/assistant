import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SERVER_PORT = 8788;
export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_BASE_URL = `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;
export const DEFAULT_LOCAL_DATA_DIR = join(homedir(), ".local", "share", "executor-v3", "control-plane");
export const SERVER_START_TIMEOUT_MS = 5_000;
export const SERVER_POLL_INTERVAL_MS = 100;
