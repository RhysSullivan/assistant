import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { probeMcpEndpointShape } from "./probe-shape";

type FetchStub = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

const asFetch = (stub: FetchStub): typeof fetch => stub as typeof fetch;

/**
 * Build a `fetch`-compatible stub that returns the given `Response` (or
 * throws the given error) regardless of input. `fetch`'s exact signature
 * is a union; a narrow closure is enough for the probe.
 */
const stubFetch = (result: Response | Error): typeof fetch =>
  asFetch(async (_input, _init) => {
    if (result instanceof Error) throw result;
    return result;
  });

const stubFetchSequence = (results: readonly Response[]): typeof fetch => {
  let index = 0;
  return asFetch(async (_input, _init) => {
    const result = results[index++];
    if (!result) throw new Error("unexpected fetch");
    return result;
  });
};

describe("probeMcpEndpointShape", () => {
  it.effect("classifies 2xx as unauth-OK MCP", () =>
    Effect.gen(function* () {
      const response = new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            serverInfo: { name: "t", version: "0" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      const result = yield* probeMcpEndpointShape("https://mcp.example/", {
        fetch: stubFetch(response),
      });
      expect(result).toEqual({ kind: "mcp", requiresAuth: false });
    }),
  );

  it.effect("classifies 401 with Bearer WWW-Authenticate as MCP+OAuth", () =>
    Effect.gen(function* () {
      const response = new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
        },
      });
      const result = yield* probeMcpEndpointShape("https://mcp.example/", {
        fetch: stubFetch(response),
      });
      expect(result).toEqual({ kind: "mcp", requiresAuth: true });
    }),
  );

  it.effect("rejects 401 without WWW-Authenticate as non-MCP", () =>
    Effect.gen(function* () {
      const response = new Response("nope", { status: 401 });
      const result = yield* probeMcpEndpointShape("https://api.example/", {
        fetch: stubFetch(response),
      });
      expect(result.kind).toBe("not-mcp");
    }),
  );

  it.effect("falls back to GET for OAuth-protected SSE endpoints", () =>
    Effect.gen(function* () {
      const post = new Response(null, { status: 405 });
      const get = new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
        },
      });
      const result = yield* probeMcpEndpointShape("https://mcp.example/sse", {
        fetch: stubFetchSequence([post, get]),
      });
      expect(result).toEqual({ kind: "mcp", requiresAuth: true });
    }),
  );

  it.effect("classifies unauthenticated SSE GET endpoints as MCP", () =>
    Effect.gen(function* () {
      const post = new Response(null, { status: 405 });
      const get = new Response("event: endpoint\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      const result = yield* probeMcpEndpointShape("https://mcp.example/sse", {
        fetch: stubFetchSequence([post, get]),
      });
      expect(result).toEqual({ kind: "mcp", requiresAuth: false });
    }),
  );

  it.effect("rejects 400 GraphQL-shape responses as non-MCP", () =>
    Effect.gen(function* () {
      // This is exactly the response Railway's backboard returns for a
      // JSON-RPC initialize POST — the bug this gate exists to catch.
      const response = new Response(
        JSON.stringify({
          errors: [{ message: "Problem processing request" }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
      const result = yield* probeMcpEndpointShape(
        "https://backboard.railway.com/graphql/v2",
        { fetch: stubFetch(response) },
      );
      expect(result.kind).toBe("not-mcp");
    }),
  );

  it.effect("rejects 404 as non-MCP", () =>
    Effect.gen(function* () {
      const response = new Response(null, { status: 404 });
      const result = yield* probeMcpEndpointShape("https://example/", {
        fetch: stubFetch(response),
      });
      expect(result.kind).toBe("not-mcp");
    }),
  );

  it.effect("reports transport failure as unreachable", () =>
    Effect.gen(function* () {
      const result = yield* probeMcpEndpointShape("https://missing/", {
        fetch: stubFetch(new TypeError("fetch failed")),
      });
      expect(result.kind).toBe("unreachable");
    }),
  );
});
