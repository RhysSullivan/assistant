import type {
  CodeExecutor,
  ExecuteResult,
  ToolInvoker,
} from "@executor-v3/codemode-core";
import * as Effect from "effect/Effect";

export type InProcessExecutorOptions = {
  timeoutMs?: number;
  allowFetch?: boolean;
};

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const formatLogArg = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatLogLine = (args: unknown[]): string => args.map(formatLogArg).join(" ");

const createToolsProxy = (
  toolInvoker: ToolInvoker,
  path: readonly string[] = [],
): unknown => {
  const callable = () => undefined;

  return new Proxy(callable, {
    get(_target, prop) {
      if (prop === "then") {
        return undefined;
      }

      if (typeof prop !== "string") {
        return undefined;
      }

      return createToolsProxy(toolInvoker, [...path, prop]);
    },
    apply(_target, _thisArg, args) {
      const toolPath = path.join(".");
      if (!toolPath) {
        throw new Error("Tool path missing in invocation");
      }

      return Effect.runPromise(
        toolInvoker.invoke({ path: toolPath, args: args[0] }),
      );
    },
  });
};

const buildExecutionSource = (code: string): string => {
  const trimmed = code.trim();
  const looksLikeArrowFunction =
    (trimmed.startsWith("async") || trimmed.startsWith("("))
    && trimmed.includes("=>");

  if (looksLikeArrowFunction) {
    return [
      '"use strict";',
      "return (async () => {",
      `const __fn = (${trimmed});`,
      "if (typeof __fn !== 'function') throw new Error('Code must evaluate to a function');",
      "return await __fn();",
      "})();",
    ].join("\n");
  }

  return [
    '"use strict";',
    "return (async () => {",
    code,
    "})();",
  ].join("\n");
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const runInProcess = (
  options: InProcessExecutorOptions,
  code: string,
  toolInvoker: ToolInvoker,
): Effect.Effect<ExecuteResult, never> =>
  Effect.gen(function* () {
    const logs: string[] = [];

    const sandboxConsole = {
      log: (...args: unknown[]) => {
        logs.push(`[log] ${formatLogLine(args)}`);
      },
      warn: (...args: unknown[]) => {
        logs.push(`[warn] ${formatLogLine(args)}`);
      },
      error: (...args: unknown[]) => {
        logs.push(`[error] ${formatLogLine(args)}`);
      },
    };

    const blockedFetch = async (..._args: unknown[]): Promise<never> => {
      throw new Error("fetch is disabled in in-process executor");
    };

    const sandboxFetch: unknown = options.allowFetch ? fetch : blockedFetch;
    const tools = createToolsProxy(toolInvoker);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const run = new Function(
      "tools",
      "console",
      "fetch",
      buildExecutionSource(code),
    ) as (
      toolsArg: unknown,
      consoleArg: Pick<Console, "log" | "warn" | "error">,
      fetchArg: unknown,
    ) => Promise<unknown>;

    const result = yield* Effect.match(
      Effect.tryPromise({
        try: () => withTimeout(run(tools, sandboxConsole, sandboxFetch), timeoutMs),
        catch: toError,
      }),
      {
        onFailure: (error: Error) => ({
          ok: false as const,
          error,
        }),
        onSuccess: (value: unknown) => ({
          ok: true as const,
          value,
        }),
      },
    );

    if (!result.ok) {
      return {
        result: null,
        error: result.error.stack ?? result.error.message,
        logs,
      } satisfies ExecuteResult;
    }

    return {
      result: result.value,
      logs,
    } satisfies ExecuteResult;
  });

export const makeInProcessExecutor = (
  options: InProcessExecutorOptions = {},
): CodeExecutor => ({
  execute: (code: string, toolInvoker: ToolInvoker) =>
    runInProcess(options, code, toolInvoker),
});
