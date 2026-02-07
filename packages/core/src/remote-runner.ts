import type { ApprovalMode, ToolTree } from "./tools.js";
import { walkToolTree } from "./tools.js";
import type { RunResult, Runner } from "./runner.js";

export interface ExecutorToolManifestEntry {
  readonly toolPath: string;
  readonly approval: ApprovalMode;
}

export interface ExecutorRunRequest {
  readonly runId: string;
  readonly code: string;
  readonly timeoutMs: number;
  readonly callbackBaseUrl: string;
  readonly callbackToken: string;
  readonly tools: readonly ExecutorToolManifestEntry[];
}

export interface ExecutorInvokeRequest {
  readonly toolPath: string;
  readonly input: unknown;
}

export interface ExecutorInvokeResponse {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
  readonly denied?: boolean;
}

export interface RemoteRunnerOptions {
  readonly tools: ToolTree;
  readonly executorUrl: string;
  readonly runId: string;
  readonly callbackBaseUrl: string;
  readonly callbackToken: string;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildToolManifest(tools: ToolTree): ExecutorToolManifestEntry[] {
  const manifest: ExecutorToolManifestEntry[] = [];
  walkToolTree(tools, (toolPath, tool) => {
    manifest.push({ toolPath, approval: tool.approval });
  });
  return manifest;
}

function isRunResult(value: unknown): value is RunResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record["ok"] === "boolean" && Array.isArray(record["receipts"]);
}

export function createRemoteRunner(options: RemoteRunnerOptions): Runner {
  const {
    tools,
    executorUrl,
    runId,
    callbackBaseUrl,
    callbackToken,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch as FetchLike,
  } = options;

  const endpoint = `${trimTrailingSlash(executorUrl)}/internal/execute`;
  const manifest = buildToolManifest(tools);

  return {
    async run(code: string): Promise<RunResult> {
      const payload: ExecutorRunRequest = {
        runId,
        code,
        timeoutMs,
        callbackBaseUrl,
        callbackToken,
        tools: manifest,
      };

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `Executor request failed: HTTP ${response.status}`,
            receipts: [],
          };
        }

        const result = await response.json();
        if (!isRunResult(result)) {
          return {
            ok: false,
            error: "Executor returned an invalid response",
            receipts: [],
          };
        }

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: `Executor request failed: ${message}`,
          receipts: [],
        };
      }
    },
  };
}
