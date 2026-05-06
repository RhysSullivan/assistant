import * as Sentry from "@sentry/cloudflare";
import { Data, Effect, Option, Predicate, Schema } from "effect";

import { jsonRpcWebResponse } from "./responses";

const SSE_PEEK_TIMEOUT_MS = 10_000;

const SandboxOutcome = Schema.Struct({
  status: Schema.optional(Schema.String),
  error: Schema.optional(
    Schema.Struct({
      kind: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
    }),
  ),
});

const JsonRpcResponseBody = Schema.Struct({
  jsonrpc: Schema.optional(Schema.String),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.optional(Schema.Number),
      message: Schema.optional(Schema.String),
    }),
  ),
  result: Schema.optional(
    Schema.Struct({
      isError: Schema.optional(Schema.Boolean),
      structuredContent: Schema.optional(SandboxOutcome),
    }),
  ),
});
type JsonRpcResponseBody = typeof JsonRpcResponseBody.Type;

const decodeJsonRpcResponseBodyJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(JsonRpcResponseBody),
);

const responseBodyShape = (body: string): string => {
  const trimmed = body.trimStart();
  if (!trimmed) return "empty";
  if (trimmed.startsWith("{")) return "json-object";
  if (trimmed.startsWith("[")) return "json-array";
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) return "sse";
  if (trimmed.startsWith("<")) return "html-or-xml";
  return "other";
};

const parseFirstJsonRpc = (contentType: string, body: string): JsonRpcResponseBody | null => {
  if (!body) return null;
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        return Option.getOrNull(decodeJsonRpcResponseBodyJson(line.slice(5).trimStart()));
      }
    }
    return null;
  }
  if (contentType.includes("application/json")) {
    return Option.getOrNull(decodeJsonRpcResponseBodyJson(body));
  }
  return null;
};

const jsonRpcResponseAttrs = (payload: JsonRpcResponseBody | null): Record<string, unknown> => {
  if (!payload || payload.jsonrpc !== "2.0") return {};
  const attrs: Record<string, unknown> = {};
  const rpcError = payload.error;
  if (rpcError && typeof rpcError === "object") {
    attrs["mcp.rpc.is_error"] = true;
    if (typeof rpcError.code === "number") attrs["mcp.rpc.error.code"] = rpcError.code;
    if (typeof rpcError.message === "string") {
      attrs["mcp.rpc.error.message"] = rpcError.message.slice(0, 500);
    }
  }
  if (payload.result?.isError === true) attrs["mcp.tool.result.is_error"] = true;
  const structured = payload.result?.structuredContent;
  if (structured && typeof structured.status === "string") {
    attrs["mcp.tool.sandbox.status"] = structured.status;
    const sandboxError = structured.error;
    if (sandboxError?.kind) attrs["mcp.tool.sandbox.error.kind"] = sandboxError.kind;
    if (typeof sandboxError?.message === "string") {
      attrs["mcp.tool.sandbox.error.message"] = sandboxError.message.slice(0, 500);
    }
  }
  return attrs;
};

class ResponseBodyTimeoutError extends Data.TaggedError("ResponseBodyTimeoutError")<{
  readonly timeoutMs: number;
}> {}

class ResponseBodyReadError extends Data.TaggedError("ResponseBodyReadError")<{
  readonly cause: unknown;
}> {}

type ResponseBodyReadFailure = ResponseBodyTimeoutError | ResponseBodyReadError;

type ResponseBodyReadOutcome =
  | { readonly type: "success"; readonly text: string }
  | { readonly type: "timeout"; readonly timeoutMs: number };

const readResponseTextOutcome = async (
  response: Response,
  timeoutMs: number | null,
): Promise<ResponseBodyReadOutcome> => {
  if (timeoutMs === null) {
    return { type: "success", text: await response.text() };
  }

  const reader = response.body?.getReader();
  if (!reader) return { type: "success", text: "" };

  const decoder = new TextDecoder();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<ResponseBodyReadOutcome>((resolve) => {
    timeout = setTimeout(() => {
      void reader.cancel().then(
        () => undefined,
        () => undefined,
      );
      resolve({ type: "timeout", timeoutMs });
    }, timeoutMs);
  });
  const readPromise = (async (): Promise<ResponseBodyReadOutcome> => {
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { type: "success", text: text + decoder.decode() };
      text += decoder.decode(value, { stream: true });
    }
  })().finally(() => {
    if (timeout) clearTimeout(timeout);
  });

  return await Promise.race([readPromise, timeoutPromise]);
};

const readResponseText = (
  response: Response,
  timeoutMs: number | null,
): Effect.Effect<string, ResponseBodyReadFailure> =>
  Effect.tryPromise({
    try: () => readResponseTextOutcome(response, timeoutMs),
    catch: (cause) => new ResponseBodyReadError({ cause }),
  }).pipe(
    Effect.flatMap((outcome) =>
      outcome.type === "timeout"
        ? Effect.fail(new ResponseBodyTimeoutError({ timeoutMs: outcome.timeoutMs }))
        : Effect.succeed(outcome.text),
    ),
  );

const annotateEmptyResponse = (response: Response, contentType: string) =>
  Effect.annotateCurrentSpan({
    "mcp.response.status_code": response.status,
    "mcp.response.content_type": contentType,
    "mcp.response.body.shape": "empty",
    "mcp.response.body.length": 0,
    "mcp.response.jsonrpc.detected": false,
  });

const withoutBodyHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const responseReadFailure = (error: ResponseBodyReadFailure) =>
  Effect.gen(function* () {
    const timedOut = Predicate.isTagged(error, "ResponseBodyTimeoutError");
    yield* Effect.annotateCurrentSpan({
      "mcp.response.status_code": timedOut ? 504 : 500,
      "mcp.response.content_type": "application/json",
      "mcp.response.body.shape": "json-object",
      "mcp.response.body.length": 0,
      "mcp.response.jsonrpc.detected": true,
      "mcp.peek_response.timed_out": timedOut,
      "mcp.peek_response.error": timedOut
        ? "Timed out waiting for MCP response body"
        : "Failed to read MCP response body",
    });
    return jsonRpcWebResponse(
      timedOut ? 504 : 500,
      -32001,
      timedOut
        ? "Timed out waiting for MCP response - please retry"
        : "Failed to read MCP response",
    );
  });

const reportInternalJsonRpcError = (payload: JsonRpcResponseBody | null) =>
  Effect.sync(() => {
    if (payload?.error?.code !== -32603) return;
    const msg = payload.error.message ?? "unknown";
    Sentry.captureMessage(`MCP internal JSON-RPC error (-32603): ${msg}`);
  });

export const peekAndAnnotate = (response: Response): Effect.Effect<Response> =>
  Effect.gen(function* () {
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status === 202) {
      yield* annotateEmptyResponse(response, contentType);
      return withoutBodyHeaders(response);
    }
    if (!response.body) {
      yield* annotateEmptyResponse(response, contentType);
      return response;
    }

    const isSseResponse = contentType.includes("text/event-stream");
    const timeoutMs = isSseResponse ? SSE_PEEK_TIMEOUT_MS : null;
    return yield* readResponseText(response, timeoutMs).pipe(
      Effect.withSpan("mcp.peek_response", {
        attributes: {
          "http.response.content_type": contentType,
          "http.response.status_code": response.status,
          "mcp.peek_response.timeout_ms": timeoutMs ?? 0,
        },
      }),
      Effect.matchEffect({
        onFailure: responseReadFailure,
        onSuccess: (text) =>
          Effect.gen(function* () {
            const payload = parseFirstJsonRpc(contentType, text);
            yield* Effect.annotateCurrentSpan({
              "mcp.response.status_code": response.status,
              "mcp.response.content_type": contentType,
              "mcp.response.body.length": text.length,
              "mcp.response.body.shape": responseBodyShape(text),
              "mcp.response.jsonrpc.detected": payload?.jsonrpc === "2.0",
            });
            const attrs = jsonRpcResponseAttrs(payload);
            if (Object.keys(attrs).length > 0) yield* Effect.annotateCurrentSpan(attrs);
            yield* reportInternalJsonRpcError(payload);

            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }),
      }),
    );
  });
