// ---------------------------------------------------------------------------
// MCP endpoint shape probe — decide whether an unknown HTTP endpoint is
// actually speaking MCP before we try to classify it as such.
//
// Background:
//
//   `discoverTools` (via the MCP SDK's StreamableHTTP / SSE transport)
//   fails for every non-MCP endpoint too — 200-with-HTML, 400-GraphQL,
//   404, etc. all surface as the same opaque transport error. When
//   `discoverTools` fails, plugin.ts falls through to
//   `startMcpOAuthAuthorization`, which succeeds against *any* URL whose
//   origin publishes OAuth 2.0 Protected Resource + Authorization Server
//   Metadata (RFC 9728 + RFC 8414) — that's what the MCP SDK's `auth()`
//   consumes. Plenty of non-MCP APIs (Railway's `backboard.railway.com/
//   graphql/v2`, anything backed by a standards-compliant OAuth AS)
//   publish that metadata, so the fall-through misclassifies them.
//
// The MCP authorization spec (`modelcontextprotocol.io/specification/
// draft/basic/authorization`) mandates the handshake that distinguishes
// a real MCP-requires-OAuth endpoint from the general case:
//
//   - On an unauthenticated request the server MUST respond `401` and
//     include `WWW-Authenticate: Bearer` with a `resource_metadata=`
//     attribute pointing at its RFC 9728 document.
//
// This module issues an unauth JSON-RPC `initialize` POST and checks
// exactly that shape. That's enough to separate "MCP server that needs
// OAuth" from "non-MCP service whose host happens to publish OAuth
// metadata". It's a single `fetch`, no MCP-SDK session state, no OAuth
// round-trip, no DCR — every non-MCP endpoint exits here.
// ---------------------------------------------------------------------------

import { Data, Duration, Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

/** MCP initialize request body used as the shape probe. Any real MCP
 *  server either answers it (unauth-OK server) or returns the spec-
 *  mandated 401 + WWW-Authenticate pair. A non-MCP endpoint hit with
 *  this body will respond with whatever it does for unknown JSON
 *  payloads — 400, 404, HTML, a GraphQL error envelope, etc. — none of
 *  which match the gate below. */
const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "executor-probe", version: "0" },
  },
});

/** Header-name lookup is case-insensitive per RFC 7230. `fetch`'s
 *  `Response.headers` already lower-cases, but we normalise explicitly
 *  to stay robust against test mocks that construct `Headers` loosely. */
const readHeader = (headers: Readonly<Record<string, string>>, name: string): string | null => {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
};

class ProbeTransportError extends Data.TaggedError("ProbeTransportError")<{
  readonly reason: string;
  readonly cause: unknown;
}> {}

const ErrorMessageShape = Schema.Struct({ message: Schema.String });
const decodeErrorMessageShape = Schema.decodeUnknownOption(ErrorMessageShape);

const reasonFromBoundaryCause = (cause: unknown): string => {
  const messageShape = decodeErrorMessageShape(cause);
  if (Option.isSome(messageShape)) return messageShape.value.message;
  if (typeof cause === "string") return cause;
  if (typeof cause === "number" || typeof cause === "boolean" || typeof cause === "bigint") {
    return `${cause}`;
  }
  if (typeof cause === "symbol") return cause.description ?? "symbol";
  if (cause === null) return "null";
  if (typeof cause === "undefined") return "undefined";
  return "fetch failed";
};

export type McpShapeProbeResult =
  /** Server answered initialize successfully — either a 2xx with a
   *  JSON-RPC payload, or a 401 + WWW-Authenticate: Bearer (RFC 6750
   *  challenge) that the MCP auth spec requires. */
  | { readonly kind: "mcp"; readonly requiresAuth: boolean }
  /** Endpoint is reachable but the response does not look like MCP. */
  | { readonly kind: "not-mcp"; readonly reason: string }
  /** Transport-level failure (DNS, TLS, timeout, abort, ...). */
  | { readonly kind: "unreachable"; readonly reason: string };

export interface ProbeOptions {
  /** Abort the request after this many ms. Default 8000. */
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
  readonly queryParams?: Record<string, string>;
}

/**
 * Hit `endpoint` with a JSON-RPC `initialize` POST and classify the
 * response according to the MCP authorization spec.
 *
 * Returns `{kind: "mcp"}` only when the endpoint either:
 *   - answers with 2xx (unauth-OK MCP server), or
 *   - responds 401 with a `Bearer` WWW-Authenticate challenge.
 *
 * Anything else (400, 404, 200-with-HTML, 200-with-GraphQL-errors, ...)
 * is classified `not-mcp`. Transport errors surface as `unreachable`.
 */
export const probeMcpEndpointShape = (
  endpoint: string,
  options: ProbeOptions = {},
): Effect.Effect<McpShapeProbeResult> =>
  Effect.gen(function* () {
    const timeoutMs = options.timeoutMs ?? 8_000;
    const outcome = yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const classify = (
        response: { readonly status: number; readonly headers: Readonly<Record<string, string>> },
        method: "GET" | "POST",
      ) => {
        if (response.status === 401) {
          const wwwAuth = readHeader(response.headers, "www-authenticate");
          if (wwwAuth && /^\s*bearer\b/i.test(wwwAuth)) {
            return { kind: "mcp", requiresAuth: true } as const;
          }
          return {
            kind: "not-mcp",
            reason: "401 without Bearer WWW-Authenticate — not an MCP auth challenge",
          } as const;
        }

        if (response.status >= 200 && response.status < 300) {
          if (method === "GET") {
            const contentType = readHeader(response.headers, "content-type") ?? "";
            if (!/^\s*text\/event-stream\b/i.test(contentType)) {
              return {
                kind: "not-mcp",
                reason: "GET response is not an SSE stream",
              } as const;
            }
          }
          return { kind: "mcp", requiresAuth: false } as const;
        }

        return null;
      };

      const url = new URL(endpoint);
      for (const [key, value] of Object.entries(options.queryParams ?? {})) {
        url.searchParams.set(key, value);
      }

      let postRequest = HttpClientRequest.post(url.toString()).pipe(
        HttpClientRequest.setHeader("content-type", "application/json"),
        HttpClientRequest.setHeader("accept", "application/json, text/event-stream"),
        HttpClientRequest.bodyText(INITIALIZE_BODY, "application/json"),
      );
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        postRequest = HttpClientRequest.setHeader(postRequest, name, value);
      }

      const postResponse = yield* client
        .execute(postRequest)
        .pipe(Effect.timeout(Duration.millis(timeoutMs)));

      const postResult = classify(postResponse, "POST");
      if (postResult) return postResult;

      if ([404, 405, 406, 415].includes(postResponse.status)) {
        let getRequest = HttpClientRequest.get(url.toString()).pipe(
          HttpClientRequest.setHeader("accept", "text/event-stream"),
        );
        for (const [name, value] of Object.entries(options.headers ?? {})) {
          getRequest = HttpClientRequest.setHeader(getRequest, name, value);
        }
        const getResponse = yield* client
          .execute(getRequest)
          .pipe(Effect.timeout(Duration.millis(timeoutMs)));
        const getResult = classify(getResponse, "GET");
        if (getResult) return getResult;
      }

      return {
        kind: "not-mcp",
        reason: `unexpected status ${postResponse.status} for initialize`,
      } as const;
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.mapError(
        (cause) =>
          new ProbeTransportError({
            reason: reasonFromBoundaryCause(cause),
            cause,
          }),
      ),
      Effect.catch((cause) =>
        Effect.succeed<McpShapeProbeResult>({
          kind: "unreachable",
          reason: cause.reason,
        }),
      ),
    );

    return outcome;
  }).pipe(Effect.withSpan("mcp.plugin.probe_shape"));
