import { Sandbox } from "@vercel/sandbox";
import type {
  ExecutionAdapter,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxRuntime,
} from "../types";
import {
  buildFormatArgs,
  buildCallInternal,
  buildOutputHelpers,
  buildCreateToolsProxy,
  buildSandboxExecution,
} from "./sandbox-fragments";

const RESULT_MARKER = "__EXECUTOR_RESULT__";

interface VercelSandboxRuntimeOptions {
  controlPlaneBaseUrl: string;
  internalToken?: string;
  runtime?: "node24" | "node22";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function buildRunnerScript(codeFilePath: string): string {
  // Composed from sandbox-fragments.ts — see that file for the mirror
  // relationship with runtime-core.ts.
  return `
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

const RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)};
const runId = process.env.EXECUTOR_RUN_ID;
const baseUrl = process.env.EXECUTOR_INTERNAL_BASE_URL;
const token = process.env.EXECUTOR_INTERNAL_TOKEN || "";
const requestTimeoutMs = Number(process.env.EXECUTOR_REQUEST_TIMEOUT_MS || "15000");

if (!runId) {
  throw new Error("Missing EXECUTOR_RUN_ID");
}

if (!baseUrl) {
  throw new Error("Missing EXECUTOR_INTERNAL_BASE_URL");
}

const userCode = await readFile(${JSON.stringify(codeFilePath)}, "utf8");
const startedAt = Date.now();
const stdoutLines = [];
const stderrLines = [];
${buildFormatArgs()}
${buildCallInternal()}
${buildOutputHelpers()}
${buildCreateToolsProxy()}
${buildSandboxExecution()}

process.stdout.write(RESULT_MARKER + JSON.stringify(result) + "\\n");
`;
}

function parseResultFromStdout(stdout: string): SandboxExecutionResult | null {
  const lines = stdout.split("\n");
  const resultLine = lines.find((line) => line.startsWith(RESULT_MARKER));
  if (!resultLine) {
    return null;
  }

  try {
    return JSON.parse(resultLine.slice(RESULT_MARKER.length)) as SandboxExecutionResult;
  } catch {
    return null;
  }
}

export class VercelSandboxRuntime implements SandboxRuntime {
  readonly id = "vercel-sandbox";
  readonly label = "Vercel Sandbox Runtime";
  readonly description = "Runs generated JavaScript inside Vercel Sandbox microVMs.";

  constructor(private readonly options: VercelSandboxRuntimeOptions) {}

  async run(
    request: SandboxExecutionRequest,
    _adapter: ExecutionAdapter,
  ): Promise<SandboxExecutionResult> {
    const startedAt = Date.now();
    const baseUrl = stripTrailingSlash(this.options.controlPlaneBaseUrl);
    if (!baseUrl) {
      return {
        status: "failed",
        stdout: "",
        stderr: "",
        error: "Vercel sandbox runtime misconfigured: missing controlPlaneBaseUrl",
        durationMs: Date.now() - startedAt,
      };
    }

    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) {
      return {
        status: "failed",
        stdout: "",
        stderr: "",
        error:
          "Vercel sandbox runtime requires a publicly reachable EXECUTOR_INTERNAL_BASE_URL (localhost is not reachable from Vercel).",
        durationMs: Date.now() - startedAt,
      };
    }

    const sandboxTimeoutMs = Math.max(request.timeoutMs + 30_000, 120_000);
    const sandbox = await Sandbox.create({
      runtime: this.options.runtime ?? "node22",
      timeout: sandboxTimeoutMs,
    });

    const codePath = "task-code.js";
    const runnerPath = "executor-runner.mjs";

    try {
      await sandbox.writeFiles([
        { path: codePath, content: Buffer.from(request.code, "utf8") },
        { path: runnerPath, content: Buffer.from(buildRunnerScript(codePath), "utf8") },
      ]);

      const command = await sandbox.runCommand({
        cmd: "node",
        args: [runnerPath],
        env: {
          EXECUTOR_RUN_ID: request.taskId,
          EXECUTOR_INTERNAL_BASE_URL: baseUrl,
          EXECUTOR_INTERNAL_TOKEN: this.options.internalToken ?? "",
          EXECUTOR_REQUEST_TIMEOUT_MS: String(request.timeoutMs),
        },
      });

      const [stdout, stderr] = await Promise.all([
        command.stdout(),
        command.stderr(),
      ]);

      const parsed = parseResultFromStdout(stdout);
      if (parsed) {
        return parsed;
      }

      return {
        status: command.exitCode === 0 ? "completed" : "failed",
        stdout,
        stderr,
        exitCode: command.exitCode,
        error: command.exitCode === 0 ? undefined : `Sandbox command exited with code ${command.exitCode}`,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: "failed",
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    } finally {
      await sandbox.stop();
    }
  }
}
