import { ResponseJson as _ResponseJson } from "./globals.js";
import { run } from "./user-code.js";

const APPROVAL_DENIED_PREFIX = "APPROVAL_DENIED:";

function decodeToolBridgeResult(rawResult) {
  const parsed = (() => {
    if (typeof rawResult === "string") {
      try {
        return JSON.parse(rawResult);
      } catch {
        return null;
      }
    }

    if (rawResult && typeof rawResult === "object") {
      return rawResult;
    }

    return null;
  })();

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      kind: "failed",
      error: "Tool bridge returned an invalid payload",
    };
  }

  if (parsed.ok === true) {
    return {
      ok: true,
      value: parsed.value,
    };
  }

  if (
    parsed.ok === false
    && parsed.kind === "pending"
    && typeof parsed.approvalId === "string"
    && typeof parsed.retryAfterMs === "number"
  ) {
    return {
      ok: false,
      kind: "pending",
      approvalId: parsed.approvalId,
      retryAfterMs: parsed.retryAfterMs,
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    };
  }

  if (parsed.ok === false && parsed.kind === "denied" && typeof parsed.error === "string") {
    return {
      ok: false,
      kind: "denied",
      error: parsed.error,
    };
  }

  if (parsed.ok === false && parsed.kind === "failed" && typeof parsed.error === "string") {
    return {
      ok: false,
      kind: "failed",
      error: parsed.error,
    };
  }

  return {
    ok: false,
    kind: "failed",
    error: "Tool bridge returned a malformed payload",
  };
}

function describeExecutionError(error) {
  if (error instanceof Error) {
    const message = typeof error.message === "string" ? error.message.trim() : "";
    if (message.length > 0) {
      return message;
    }

    const stack = typeof error.stack === "string" ? error.stack.trim() : "";
    if (stack.length > 0) {
      return stack;
    }

    return "Execution failed with an empty Error object";
  }

  const text = String(error).trim();
  if (text.length > 0) {
    return text;
  }

  return "Execution failed with an empty non-Error throw value";
}

function createToolsProxy(bridge, path = []) {
  const callable = () => {};

  return new Proxy(callable, {
    get(_target, prop) {
      if (prop === "then") {
        return undefined;
      }

      if (typeof prop !== "string") {
        return undefined;
      }

      return createToolsProxy(bridge, [...path, prop]);
    },

    async apply(_target, _thisArg, args) {
      const toolPath = path.join(".");
      if (!toolPath) {
        throw new Error("Tool path missing");
      }

      const input = args.length > 0 ? args[0] : {};
      const callId = `call_${crypto.randomUUID()}`;
      const result = decodeToolBridgeResult(
        await bridge.callTool(toolPath, input, callId),
      );

      if (result.ok) {
        return result.value;
      }

      if (result.kind === "pending") {
        throw new Error(
          `Tool call is unexpectedly pending approval (${result.approvalId})`,
        );
      }

      if (result.kind === "denied") {
        throw new Error(APPROVAL_DENIED_PREFIX + result.error);
      }

      const errorText = typeof result.error === "string" ? result.error.trim() : "";
      throw new Error(
        errorText.length > 0
          ? errorText
          : `Tool call failed without an error message (${toolPath})`,
      );
    },
  });
}

function sanitizeExecutionResult(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return null;
    }

    return JSON.parse(serialized);
  } catch {
    return String(value);
  }
}

export default {
  async fetch(_request, env, _ctx) {
    const tools = createToolsProxy(env.TOOL_BRIDGE);
    const console = {
      log: (..._args) => {},
      info: (..._args) => {},
      warn: (..._args) => {},
      error: (..._args) => {},
    };

    try {
      const value = await run(tools, console);
      return _ResponseJson({
        status: "completed",
        result: sanitizeExecutionResult(value),
        exitCode: 0,
      });
    } catch (error) {
      const message = describeExecutionError(error);

      if (message.startsWith(APPROVAL_DENIED_PREFIX)) {
        const denied = message.replace(APPROVAL_DENIED_PREFIX, "").trim();
        return _ResponseJson({
          status: "denied",
          error: denied,
        });
      }

      return _ResponseJson({
        status: "failed",
        error: message,
      });
    }
  },
};
