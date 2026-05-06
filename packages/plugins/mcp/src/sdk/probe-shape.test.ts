import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { serveTestHttpApp } from "@executor-js/sdk/testing";

import { probeMcpEndpointShape } from "./probe-shape";

interface CapturedProbeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

type ProbeHandler = (request: CapturedProbeRequest) => HttpServerResponse.HttpServerResponse;

const serveProbeEndpoint = (handler: ProbeHandler) =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<readonly CapturedProbeRequest[]>([]);
    const server = yield* serveTestHttpApp((request) =>
      Effect.gen(function* () {
        const body = yield* request.text;
        const captured = {
          method: request.method,
          url: request.url ?? "/",
          headers: request.headers,
          body,
        };
        yield* Ref.update(requests, (all) => [...all, captured]);
        return handler(captured);
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("probe fixture request failed", { status: 500 })),
        ),
      ),
    );

    return {
      endpoint: server.url("/probe"),
      requests: Ref.get(requests),
    } as const;
  });

const withServer = <A, E>(handler: ProbeHandler, use: (endpoint: string) => Effect.Effect<A, E>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* serveProbeEndpoint(handler);
      return yield* use(server.endpoint);
    }),
  );

describe("probeMcpEndpointShape", () => {
  it.effect("classifies 2xx as unauth-OK MCP", () =>
    withServer(
      () =>
        HttpServerResponse.jsonUnsafe({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            serverInfo: { name: "t", version: "0" },
          },
        }),
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeMcpEndpointShape(endpoint);
          expect(result).toEqual({ kind: "mcp", requiresAuth: false });
        }),
    ),
  );

  it.effect("classifies 401 with Bearer WWW-Authenticate as MCP+OAuth", () =>
    withServer(
      () =>
        HttpServerResponse.empty({
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
          },
        }),
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeMcpEndpointShape(endpoint);
          expect(result).toEqual({ kind: "mcp", requiresAuth: true });
        }),
    ),
  );

  it.effect("rejects 401 without WWW-Authenticate as non-MCP", () =>
    withServer(
      () => HttpServerResponse.text("nope", { status: 401 }),
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeMcpEndpointShape(endpoint);
          expect(result.kind).toBe("not-mcp");
        }),
    ),
  );

  it.effect("falls back to GET for OAuth-protected SSE endpoints", () =>
    withServer(
      (request) => {
        if (request.method === "POST") {
          return HttpServerResponse.empty({ status: 405 });
        }
        return HttpServerResponse.empty({
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
          },
        });
      },
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeMcpEndpointShape(endpoint);
          expect(result).toEqual({ kind: "mcp", requiresAuth: true });
        }),
    ),
  );

  it.effect("classifies unauthenticated SSE GET endpoints as MCP", () =>
    withServer(
      (request) => {
        if (request.method === "POST") {
          return HttpServerResponse.empty({ status: 405 });
        }
        return HttpServerResponse.text("event: endpoint\n\n", {
          status: 200,
          contentType: "text/event-stream",
        });
      },
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeMcpEndpointShape(endpoint);
          expect(result).toEqual({ kind: "mcp", requiresAuth: false });
        }),
    ),
  );

  it.effect("rejects 400 GraphQL-shape responses as non-MCP", () =>
    withServer(
      () =>
        HttpServerResponse.jsonUnsafe(
          { errors: [{ message: "Problem processing request" }] },
          { status: 400 },
        ),
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeMcpEndpointShape(endpoint);
          expect(result.kind).toBe("not-mcp");
        }),
    ),
  );

  it.effect("rejects 404 as non-MCP", () =>
    withServer(
      () => HttpServerResponse.empty({ status: 404 }),
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeMcpEndpointShape(endpoint);
          expect(result.kind).toBe("not-mcp");
        }),
    ),
  );

  it.effect("reports transport failure as unreachable", () =>
    Effect.gen(function* () {
      const result = yield* probeMcpEndpointShape("http://127.0.0.1:1/missing", {
        timeoutMs: 100,
      });
      expect(result.kind).toBe("unreachable");
    }),
  );
});
