import { createServer } from "node:http";

import { describe, expect, it } from "@effect/vitest";
import { SourceIdSchema } from "#schema";
import * as Effect from "effect/Effect";
import { vi } from "vitest";

import { createSourceFromPayload } from "../source-definitions";
import { graphqlSourceAdapter } from "./graphql";

describe("graphql source adapter", () => {
  it("fails sync when introspection never responds", async () => {
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

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve GraphQL adapter test server address");
    }

    const originalAbortSignalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => originalAbortSignalTimeout(25));

    try {
      const source = await Effect.runPromise(
        createSourceFromPayload({
          workspaceId: "ws_test" as any,
          sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
          payload: {
            name: "GraphQL Timeout",
            kind: "graphql",
            endpoint: `http://127.0.0.1:${address.port}/graphql`,
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
        }),
      );

      await expect(
        Effect.runPromise(
          graphqlSourceAdapter.syncCatalog({
            source,
            resolveSecretMaterial: () => Effect.fail(new Error("unexpected secret lookup")),
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
        ),
      ).rejects.toThrow(/timed out/i);
    } finally {
      timeoutSpy.mockRestore();
      await new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        sockets.forEach((socket) => socket.destroy());
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
