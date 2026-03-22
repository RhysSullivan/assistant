import {
  createServer,
} from "node:http";

import {
  describe,
  expect,
  it,
} from "@effect/vitest";
import {
  SourceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import {
  vi,
} from "vitest";

import {
  createSourceFromPayload,
} from "../source-definitions";
import {
  graphqlSourceAdapter,
} from "./graphql";
import {
  runtimeEffectError,
} from "../../effect-errors";

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const makeHungGraphqlServer = Effect.acquireRelease(
  Effect.tryPromise({
    try: () =>
      new Promise<{
        endpoint: string;
        server: ReturnType<typeof createServer>;
        sockets: Set<import("node:net").Socket>;
      }>((resolve, reject) => {
        const server = createServer((request) => {
          if (request.method === "POST" && request.url === "/graphql") {
            return;
          }
        });
        const sockets = new Set<import("node:net").Socket>();

        server.on("connection", (socket) => {
          sockets.add(socket);
          socket.on("close", () => {
            sockets.delete(socket);
          });
        });

        server.listen(0, "127.0.0.1", (error?: Error) => {
          if (error) {
            reject(error);
            return;
          }

          const address = server.address();
          if (!address || typeof address === "string") {
            reject(
              new Error(
                "Failed to resolve GraphQL adapter test server address",
              ),
            );
            return;
          }

          resolve({
            endpoint: `http://127.0.0.1:${address.port}/graphql`,
            server,
            sockets,
          });
        });
      }),
    catch: toError,
  }),
  ({ server, sockets }) =>
    Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections?.();
          sockets.forEach((socket) => socket.destroy());
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
      catch: toError,
    }),
);

describe("graphql source adapter", () => {
  it.scoped("fails sync when introspection never responds", () =>
    Effect.gen(function* () {
      const { endpoint } = yield* makeHungGraphqlServer;
      const originalAbortSignalTimeout = AbortSignal.timeout.bind(AbortSignal);
      const timeoutSpy = yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi
            .spyOn(AbortSignal, "timeout")
            .mockImplementation(() => originalAbortSignalTimeout(25)),
        ),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );

      const source = yield* createSourceFromPayload({
        scopeId: "ws_test" as any,
        sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
        payload: {
          name: "GraphQL Timeout",
          kind: "graphql",
          endpoint,
          namespace: "graphql.timeout",
          binding: {
            defaultHeaders: null,
          },
          importAuthPolicy: "reuse_runtime",
          importAuth: { kind: "none" },
          auth: { kind: "none" },
          status: "connected",
          enabled: true,
        },
        now: Date.now(),
      });

      const failure = yield* Effect.flip(
        graphqlSourceAdapter.syncCatalog({
          source,
          resolveSecretMaterial: () =>
            Effect.fail(
              runtimeEffectError(
                "sources/source-adapters/graphql.test",
                "unexpected secret lookup",
              ),
            ),
          resolveAuthMaterialForSlot: () =>
            Effect.succeed({
              placements: [],
              headers: {},
              queryParams: {},
              cookies: {},
              bodyValues: {},
              expiresAt: null,
              refreshAfter: null,
            }),
        }),
      );

      expect(timeoutSpy).toBeDefined();
      expect(failure.message).toMatch(/timed out/i);
    }),
  );
});
