/**
 * String fragments for the Vercel sandbox runner script.
 *
 * The Vercel sandbox runs code in a remote microVM that cannot import local
 * modules, so its entire runtime must be shipped as a self-contained JS string.
 * These fragments mirror the TypeScript logic in runtime-core.ts — keep them
 * in sync when making behavioural changes.
 *
 * Constants from execution-constants.ts are interpolated at build time so the
 * sandbox never hardcodes magic strings.
 */

import {
  APPROVAL_DENIED_PREFIX,
  TASK_TIMEOUT_MARKER,
} from "../execution-constants";

// ---------------------------------------------------------------------------
// Shared helper: formatArgs
// Mirror of: runtime-core.ts formatArgs()
// ---------------------------------------------------------------------------
export function buildFormatArgs(): string {
  return `
function formatArgs(args) {
  return args.map((value) => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(" ");
}`;
}

// ---------------------------------------------------------------------------
// HTTP helper (sandbox-only — runtime-core uses the adapter directly)
// ---------------------------------------------------------------------------
export function buildCallInternal(): string {
  return `
async function callInternal(path, payload) {
  const response = await fetch(baseUrl + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const message = typeof data.error === "string"
      ? data.error
      : "Internal request failed (" + response.status + ")";
    throw new Error(message);
  }

  return data;
}`;
}

// ---------------------------------------------------------------------------
// Output helpers
// Mirror of: runtime-core.ts appendStdout / appendStderr
// ---------------------------------------------------------------------------
export function buildOutputHelpers(): string {
  return `
function emitOutput(stream, line) {
  return callInternal("/internal/runs/" + encodeURIComponent(runId) + "/output", {
    stream,
    line,
    timestamp: Date.now(),
  });
}

function appendStdout(line) {
  stdoutLines.push(line);
  void emitOutput("stdout", line);
}

function appendStderr(line) {
  stderrLines.push(line);
  void emitOutput("stderr", line);
}`;
}

// ---------------------------------------------------------------------------
// Shared helper: createToolsProxy
// Mirror of: runtime-core.ts createToolsProxy()
// The sandbox version calls HTTP endpoints instead of adapter.invokeTool().
// ---------------------------------------------------------------------------
export function buildCreateToolsProxy(): string {
  return `
function createToolsProxy(path = []) {
  const callable = () => {};
  return new Proxy(callable, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return undefined;
      return createToolsProxy([...path, prop]);
    },
    async apply(_target, _thisArg, args) {
      const toolPath = path.join(".");
      if (!toolPath) {
        throw new Error("Tool path missing in invocation");
      }

      const data = await callInternal(
        "/internal/runs/" + encodeURIComponent(runId) + "/tool-call",
        {
          callId: "call_" + randomUUID(),
          toolPath,
          input: args.length > 0 ? args[0] : {},
        },
      );

      if (data.ok) {
        return data.value;
      }

      if (data.denied) {
        throw new Error(${JSON.stringify(APPROVAL_DENIED_PREFIX)} + String(data.error || "Tool call denied"));
      }

      throw new Error(String(data.error || "Tool call failed"));
    },
  });
}`;
}

// ---------------------------------------------------------------------------
// Shared: sandbox + context setup, execution, and result mapping
// Mirror of: runtime-core.ts runCodeWithAdapter() execution & catch blocks
// ---------------------------------------------------------------------------
export function buildSandboxExecution(): string {
  return `
const tools = createToolsProxy();
const consoleProxy = {
  log: (...args) => appendStdout(formatArgs(args)),
  info: (...args) => appendStdout(formatArgs(args)),
  warn: (...args) => appendStderr(formatArgs(args)),
  error: (...args) => appendStderr(formatArgs(args)),
};

const sandbox = Object.assign(Object.create(null), {
  tools,
  console: consoleProxy,
  setTimeout,
  clearTimeout,
});
const context = vm.createContext(sandbox, {
  codeGeneration: {
    strings: false,
    wasm: false,
  },
});
const runnerScript = new vm.Script("(async () => {\\n\\"use strict\\";\\n" + userCode + "\\n})()");

const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error(${JSON.stringify(TASK_TIMEOUT_MARKER)})), requestTimeoutMs);
});

let result;
try {
  const value = await Promise.race([
    Promise.resolve(runnerScript.runInContext(context, { timeout: Math.max(1, requestTimeoutMs) })),
    timeoutPromise,
  ]);
  if (value !== undefined) {
    appendStdout("result: " + formatArgs([value]));
  }

  result = {
    status: "completed",
    stdout: stdoutLines.join("\\n"),
    stderr: stderrLines.join("\\n"),
    exitCode: 0,
    durationMs: Date.now() - startedAt,
  };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message === ${JSON.stringify(TASK_TIMEOUT_MARKER)} || message.includes("Script execution timed out")) {
    const timeoutMessage = "Execution timed out after " + requestTimeoutMs + "ms";
    appendStderr(timeoutMessage);
    result = {
      status: "timed_out",
      stdout: stdoutLines.join("\\n"),
      stderr: stderrLines.join("\\n"),
      error: timeoutMessage,
      durationMs: Date.now() - startedAt,
    };
  } else if (message.startsWith(${JSON.stringify(APPROVAL_DENIED_PREFIX)})) {
    const deniedMessage = message.slice(${JSON.stringify(APPROVAL_DENIED_PREFIX)}.length).trim();
    appendStderr(deniedMessage);
    result = {
      status: "denied",
      stdout: stdoutLines.join("\\n"),
      stderr: stderrLines.join("\\n"),
      error: deniedMessage,
      durationMs: Date.now() - startedAt,
    };
  } else {
    appendStderr(message);
    result = {
      status: "failed",
      stdout: stdoutLines.join("\\n"),
      stderr: stderrLines.join("\\n"),
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}`;
}
