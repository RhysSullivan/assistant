import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { discoverSource } from "./source-discovery";

type TestServer = {
  url: string;
  close: () => Promise<void>;
};

const withServer = async (
  handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void,
): Promise<TestServer> => {
  const server = createServer(handler);
  const sockets = new Set<import("node:net").Socket>();

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
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
  };
};

describe("source-discovery", () => {
  it("detects OpenAPI and infers bearer auth from security schemes", async () => {
    const server = await withServer((request, response) => {
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
      response.end(JSON.stringify({
        openapi: "3.0.3",
        info: {
          title: "Secure Example API",
          version: "1.0.0",
        },
        servers: [{ url: `${server.url}/api` }],
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
      }));
    });

    try {
      const result = await Effect.runPromise(discoverSource({
        url: `${server.url}/openapi.json`,
        probeAuth: {
          kind: "bearer",
          token: "top-secret",
        },
      }));

      expect(result.detectedKind).toBe("openapi");
      expect(result.authInference.suggestedKind).toBe("bearer");
      expect(result.authInference.supported).toBe(true);
      expect(result.authInference.headerName).toBe("Authorization");
      expect(result.specUrl).toBe(`${server.url}/openapi.json`);
      expect(result.endpoint).toBe(`${server.url}/api`);
      expect(result.toolCount).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("detects GraphQL from successful introspection", async () => {
    const server = await withServer((request, response) => {
      if (request.url !== "/graphql" || request.method !== "POST") {
        response.statusCode = 404;
        response.end();
        return;
      }

      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        data: {
          __schema: {
            queryType: {
              name: "Query",
            },
          },
        },
      }));
    });

    try {
      const result = await Effect.runPromise(discoverSource({
        url: `${server.url}/graphql`,
      }));

      expect(result.detectedKind).toBe("graphql");
      expect(result.confidence).toBe("high");
      expect(result.authInference.suggestedKind).toBe("none");
      expect(result.specUrl).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("detects Google Discovery documents", async () => {
    const server = await withServer((request, response) => {
      if (request.url !== "/gmail/$discovery/rest?version=v1") {
        response.statusCode = 404;
        response.end();
        return;
      }

      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        name: "gmail",
        version: "v1",
        title: "Gmail API",
        description: "Access Gmail mailboxes and settings.",
        rootUrl: `${server.url}/`,
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
      }));
    });

    try {
      const result = await Effect.runPromise(discoverSource({
        url: `${server.url}/gmail/$discovery/rest?version=v1`,
      }));

      expect(result.detectedKind).toBe("google_discovery");
      expect(result.specUrl).toBe(`${server.url}/gmail/$discovery/rest?version=v1`);
      expect(result.endpoint).toBe(`${server.url}/gmail/v1/users/`);
      expect(result.name).toBe("Gmail API");
      expect(result.namespace).toBe("gmail");
      expect(result.authInference.suggestedKind).toBe("oauth2");
      expect(result.authInference.oauthScopes).toEqual([
        "https://www.googleapis.com/auth/gmail.readonly",
      ]);
      expect(result.toolCount).toBe(1);
    } finally {
      await server.close();
    }
  });
});
