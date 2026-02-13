import { Result } from "better-result";
import type { Env, RunRequest, RunResult } from "./types";
import { getEntrypointExports } from "./bridge";

/**
 * Build the user code module. The code is wrapped in an exported async
 * function `run(tools, console)` so the harness can call it with controlled
 * scope bindings. The user code runs in a separate module from the harness
 * and cannot access `req`, `env`, `ctx`, or `Response`.
 */
function buildUserModule(userCode: string): string {
  return `export async function run(tools, console) {\n"use strict";\n${userCode}\n}\n`;
}

export async function executeSandboxRun(
  request: RunRequest,
  ctx: ExecutionContext,
  env: Env,
  harnessCode: string,
  globalsModule: string,
): Promise<RunResult> {
  const timeoutMs = request.timeoutMs ?? 300_000;
  const isolateId = request.taskId;

  const ctxExports = getEntrypointExports(ctx);

  const toolBridgeBinding = ctxExports.ToolBridge({
    props: {
      callbackConvexUrl: request.callback.convexUrl,
      callbackInternalSecret: request.callback.internalSecret,
      taskId: request.taskId,
    },
  });

  const worker = env.LOADER.get(isolateId, async () => ({
    compatibilityDate: "2025-06-01",
    mainModule: "harness.js",
    modules: {
      "harness.js": harnessCode,
      "globals.js": globalsModule,
      "user-code.js": buildUserModule(request.code),
    },
    env: {
      TOOL_BRIDGE: toolBridgeBinding,
    },
    globalOutbound: null,
  }));

  const entrypoint = worker.getEntrypoint();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await Result.tryPromise(() =>
    entrypoint.fetch("http://sandbox.internal/run", {
      method: "POST",
      signal: controller.signal,
    }),
  );

  clearTimeout(timer);

  if (response.isErr()) {
    const cause = response.error.cause;
    if (cause instanceof DOMException && cause.name === "AbortError") {
      return {
        status: "timed_out",
        error: `Execution timed out after ${timeoutMs}ms`,
      };
    }
    throw cause;
  }

  const body = await Result.tryPromise(() => response.value.json() as Promise<RunResult>);
  if (body.isErr()) {
    return {
      status: "failed",
      error: "Sandbox isolate returned invalid JSON",
    };
  }
  return body.value;
}
