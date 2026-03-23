import {
  createServer,
} from "node:http";

import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "@effect/platform";
import {
  describe,
  expect,
  it,
} from "vitest";
import {
  SourceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import {
  Schema,
} from "effect";

import {
  openApiSourceAdapter,
} from "@executor/source-openapi";

import {
  snapshotFromSourceCatalogSyncResult,
} from "../catalog-sync-result";
import {
  createSourceFromPayload,
} from "../source-definitions";
import {
  runtimeEffectError,
} from "../../effect-errors";

const ownerParam = HttpApiSchema.param("owner", Schema.String);
const repoParam = HttpApiSchema.param("repo", Schema.String);

class OpenApiAdapterTestReposApi extends HttpApiGroup.make("repos")
  .add(
    HttpApiEndpoint.get("getRepo")`/repos/${ownerParam}/${repoParam}`
      .addSuccess(Schema.Struct({
        full_name: Schema.String,
      })),
  )
{}

class OpenApiAdapterTestApi extends HttpApi.make("openApiAdapterTest").add(
  OpenApiAdapterTestReposApi,
) {}

const generatedOpenApiSpec = JSON.stringify(OpenApi.fromApi(OpenApiAdapterTestApi));

const withAuthSensitiveSpecServer = async <T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> => {
  const server = createServer((request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "127.0.0.1"}`,
    );

    if (requestUrl.pathname === "/openapi.json") {
      if (typeof request.headers.authorization === "string") {
        response.writeHead(403, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify({
          error: "authenticated spec fetch forbidden",
        }));
        return;
      }

      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(generatedOpenApiSpec);
      return;
    }

    if (
      request.method === "GET"
      && requestUrl.pathname === "/repos/executor/api-x"
    ) {
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({
        full_name: "executor/api-x",
      }));
      return;
    }

    response.writeHead(404);
    response.end("not found");
  });

  try {
    const address = await new Promise<import("node:net").AddressInfo>(
      (resolve, reject) => {
        server.listen(0, "127.0.0.1", (error?: Error) => {
          if (error) {
            reject(error);
            return;
          }

          const currentAddress = server.address();
          if (!currentAddress || typeof currentAddress === "string") {
            reject(new Error("Failed to resolve OpenAPI adapter test server"));
            return;
          }

          resolve(currentAddress);
        });
      },
    );

    return await handler(`http://127.0.0.1:${address.port}`);
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

describe("openapi source adapter", () => {
  it(
    "falls back to an unauthenticated spec fetch when a public spec rejects attached auth",
    async () => {
      await withAuthSensitiveSpecServer(async (baseUrl) => {
        const source = await Effect.runPromise(
          createSourceFromPayload({
            scopeId: "ws_test" as any,
            sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
            payload: {
              name: "OpenAPI Public Spec",
              kind: "openapi",
              endpoint: baseUrl,
              namespace: "openapi.public-spec",
              binding: {
                specUrl: `${baseUrl}/openapi.json`,
                defaultHeaders: null,
                oauth2: null,
              },
              importAuthPolicy: "reuse_runtime",
              importAuth: { kind: "none" },
              auth: {
                kind: "bearer",
                headerName: "Authorization",
                prefix: "Bearer ",
                token: {
                  providerId: "keychain",
                  handle: "sec_test" as any,
                },
              },
              status: "connected",
              enabled: true,
            },
            now: Date.now(),
          }),
        );

        const syncResult = await Effect.runPromise(
          openApiSourceAdapter.syncCatalog({
            source,
            resolveSecretMaterial: () =>
              Effect.fail(
                runtimeEffectError(
                  "sources/source-adapters/openapi.test",
                  "unexpected secret lookup",
                ),
              ),
            resolveAuthMaterialForSlot: () =>
              Effect.succeed({
                placements: [],
                headers: {
                  Authorization: "Bearer rejected-token",
                },
                queryParams: {},
                cookies: {},
                bodyValues: {},
                expiresAt: null,
                refreshAfter: null,
              }),
          }),
        );

        const snapshot = snapshotFromSourceCatalogSyncResult(syncResult);
        expect(Object.keys(snapshot.catalog.capabilities)).not.toHaveLength(0);
      });
    },
  );
});
