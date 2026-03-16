import { createServer } from "node:http";

import { describe, expect, it } from "@effect/vitest";
import { SourceIdSchema } from "#schema";

import * as Effect from "effect/Effect";

import { googleDiscoverySourceAdapter } from "./google-discovery";
import { snapshotFromSourceCatalogSyncResult } from "../catalog-sync-result";
import { createSourceFromPayload } from "../source-definitions";

const fetchLiveDiscoveryDocument = async (): Promise<string> => {
  const response = await fetch("https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest", {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Sheets discovery doc: ${response.status}`);
  }

  return response.text();
};

const withStaticServer = async <T>(content: string, handler: (baseUrl: string) => Promise<T>): Promise<T> => {
  const server = createServer((_, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(content);
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

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve static server address");
    }
    return await handler(`http://127.0.0.1:${address.port}/sheets.discovery.json`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
};

describe("google discovery source adapter", () => {
  it("syncs a real Google Sheets discovery doc into snapshot content", () =>
    Effect.tryPromise({
      try: async () => {
        const discoveryDocument = await fetchLiveDiscoveryDocument();

        await withStaticServer(discoveryDocument, async (discoveryUrl) => {
          const source = await Effect.runPromise(
            createSourceFromPayload({
              workspaceId: "ws_test" as any,
              sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
              payload: {
                name: "Google Sheets",
                kind: "google_discovery",
                endpoint: discoveryUrl,
                namespace: "google.sheets",
                binding: {
                  service: "sheets",
                  version: "v4",
                  discoveryUrl,
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

          const syncResult = await Effect.runPromise(
            googleDiscoverySourceAdapter.syncCatalog({
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
          );
          const snapshot = snapshotFromSourceCatalogSyncResult(syncResult);

          expect(syncResult.fragment.version).toBe("ir.v1.fragment");
          expect(Object.values(snapshot.catalog.documents)[0]?.kind).toBe("google-discovery");
          expect(Object.keys(snapshot.catalog.resources)).not.toHaveLength(0);
          expect(Object.keys(snapshot.catalog.capabilities).length).toBeGreaterThan(50);
          expect(
            Object.values(snapshot.catalog.capabilities).some((capability) =>
              capability.surface.toolPath.join(".") === "google.sheets.spreadsheets.values.get"
            ),
          ).toBe(true);
        });
      },
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    }));
});
