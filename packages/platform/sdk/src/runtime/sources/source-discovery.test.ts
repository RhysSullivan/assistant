import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  describe,
  expect,
  it,
} from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  discoverSource,
} from "./source-discovery";

type TestServer = {
  url: string;
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const makeServer = (
  handler: (input: {
    request: IncomingMessage;
    response: ServerResponse<IncomingMessage>;
    url: string;
  }) => void,
) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        new Promise<{
          server: ReturnType<typeof createServer>;
          sockets: Set<import("node:net").Socket>;
          url: string;
        }>((resolve, reject) => {
          let serverUrl = "";
          const server = createServer((request, response) =>
            handler({
              request,
              response,
              url: serverUrl,
            }),
          );
          const sockets = new Set<import("node:net").Socket>();

          server.on("connection", (socket) => {
            sockets.add(socket);
            socket.on("close", () => {
              sockets.delete(socket);
            });
          });

          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
              reject(new Error("Failed to resolve test server address"));
              return;
            }

            serverUrl = `http://127.0.0.1:${address.port}`;
            resolve({
              server,
              sockets,
              url: serverUrl,
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
  ).pipe(Effect.map(({ url }) => ({ url }) satisfies TestServer));

describe("source-discovery", () => {
  it.scoped(
    "detects OpenAPI and infers bearer auth from security schemes",
    () =>
      Effect.gen(function* () {
        const server = yield* makeServer(({ request, response, url }) => {
          if (request.url !== "/openapi.json") {
            response.statusCode = 404;
            response.end();
            return;
          }

          if (request.headers.authorization !== "Bearer top-secret") {
            response.statusCode = 401;
            response.setHeader("www-authenticate", 'Bearer realm="spec"');
            response.end("Unauthorized");
            return;
          }

          response.statusCode = 200;
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              openapi: "3.0.3",
              info: {
                title: "Secure Example API",
                version: "1.0.0",
              },
              servers: [{ url: `${url}/api` }],
              components: {
                securitySchemes: {
                  bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                  },
                },
              },
              security: [{ bearerAuth: [] }],
              paths: {
                "/widgets": {
                  get: {
                    operationId: "widgets/list",
                    responses: {
                      200: {
                        description: "ok",
                      },
                    },
                  },
                },
              },
            }),
          );
        });

        const result = yield* discoverSource({
          url: `${server.url}/openapi.json`,
          probeAuth: {
            kind: "bearer",
            token: "top-secret",
          },
        });

        expect(result.detectedKind).toBe("openapi");
        expect(result.authInference.suggestedKind).toBe("bearer");
        expect(result.authInference.supported).toBe(true);
        expect(result.authInference.headerName).toBe("Authorization");
        expect(result.specUrl).toBe(`${server.url}/openapi.json`);
        expect(result.endpoint).toBe(`${server.url}/api`);
        expect(result.toolCount).toBe(1);
      }),
  );

  it.scoped("detects GraphQL from successful introspection", () =>
    Effect.gen(function* () {
      const server = yield* makeServer(({ request, response }) => {
        if (request.url !== "/graphql" || request.method !== "POST") {
          response.statusCode = 404;
          response.end();
          return;
        }

        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            data: {
              __schema: {
                queryType: {
                  name: "Query",
                },
              },
            },
          }),
        );
      });

      const result = yield* discoverSource({
        url: `${server.url}/graphql`,
      });

      expect(result.detectedKind).toBe("graphql");
      expect(result.confidence).toBe("high");
      expect(result.authInference.suggestedKind).toBe("none");
      expect(result.specUrl).toBeNull();
    }),
  );

  it.scoped("detects Google Discovery documents", () =>
    Effect.gen(function* () {
      const server = yield* makeServer(({ request, response, url }) => {
        if (request.url !== "/gmail/$discovery/rest?version=v1") {
          response.statusCode = 404;
          response.end();
          return;
        }

        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            name: "gmail",
            version: "v1",
            title: "Gmail API",
            description: "Access Gmail mailboxes and settings.",
            rootUrl: `${url}/`,
            servicePath: "gmail/v1/users/",
            auth: {
              oauth2: {
                scopes: {
                  "https://www.googleapis.com/auth/gmail.readonly": {
                    description: "View your email messages and settings",
                  },
                },
              },
            },
            methods: {
              getProfile: {
                id: "gmail.users.getProfile",
                path: "{userId}/profile",
                httpMethod: "GET",
                parameters: {
                  userId: {
                    type: "string",
                    required: true,
                    location: "path",
                  },
                },
                response: {
                  $ref: "Profile",
                },
              },
            },
            schemas: {
              Profile: {
                id: "Profile",
                type: "object",
                properties: {
                  emailAddress: {
                    type: "string",
                  },
                },
              },
            },
          }),
        );
      });

      const result = yield* discoverSource({
        url: `${server.url}/gmail/$discovery/rest?version=v1`,
      });

      expect(result.detectedKind).toBe("google_discovery");
      expect(result.specUrl).toBe(
        `${server.url}/gmail/$discovery/rest?version=v1`,
      );
      expect(result.endpoint).toBe(`${server.url}/gmail/v1/users/`);
      expect(result.name).toBe("Gmail API");
      expect(result.namespace).toBe("gmail");
      expect(result.authInference.suggestedKind).toBe("oauth2");
      expect(result.authInference.oauthScopes).toEqual([
        "https://www.googleapis.com/auth/gmail.readonly",
      ]);
      expect(result.toolCount).toBe(1);
    }),
  );
});
