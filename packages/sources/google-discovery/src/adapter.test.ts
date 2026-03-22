import { createServer } from "node:http";

import { describe, expect, it } from "@effect/vitest";
import {
  EXECUTABLE_BINDING_VERSION,
  type Source,
} from "@executor/source-core";
import * as Effect from "effect/Effect";

import { googleDiscoverySourceAdapter } from "./adapter";
import { googleDiscoveryProviderDataFromDefinition } from "./tools";

const withJsonServer = async <T>(handler: (input: {
  baseUrl: string;
  requests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>;
}) => Promise<T>): Promise<T> => {
  const requests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    requests.push({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    });

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        ok: true,
        url: request.url ?? "/",
      }),
    );
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
      throw new Error("Failed to resolve local adapter test server address");
    }
    return await handler({
      baseUrl: `http://127.0.0.1:${address.port}`,
      requests,
    });
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

const makeGoogleDiscoverySource = (discoveryUrl: string): Source => ({
  id: "src_google_gmail",
  scopeId: "ws_test",
  name: "Gmail",
  kind: "google_discovery",
  endpoint: discoveryUrl,
  status: "connected",
  enabled: true,
  namespace: "google.gmail",
  bindingVersion: 1,
  binding: {
    service: "gmail",
    version: "v1",
    discoveryUrl,
    defaultHeaders: null,
    scopes: [],
  },
  importAuthPolicy: "reuse_runtime",
  importAuth: { kind: "none" },
  auth: { kind: "none" },
  sourceHash: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("google discovery source adapter", () => {
  it("invokes requests against the discovery document runtime root instead of the stored discovery endpoint", () =>
    Effect.tryPromise({
      try: async () => {
        await withJsonServer(async ({ baseUrl, requests }) => {
          const discoveryUrl = `${baseUrl}/$discovery/rest?version=v1`;
          const source = makeGoogleDiscoverySource(discoveryUrl);
          const providerData = googleDiscoveryProviderDataFromDefinition({
            service: "gmail",
            version: "v1",
            rootUrl: `${baseUrl}/`,
            servicePath: "gmail/v1/",
            definition: {
              toolId: "users.messages.list",
              rawToolId: "users.messages.list",
              methodId: "gmail.users.messages.list",
              name: "List Messages",
              description: null,
              group: "users.messages",
              leaf: "list",
              method: "get",
              path: "users/{userId}/messages",
              flatPath: null,
              parameters: [
                {
                  name: "userId",
                  location: "path",
                  required: true,
                  repeated: false,
                  description: null,
                  type: "string",
                },
                {
                  name: "labelIds",
                  location: "query",
                  required: false,
                  repeated: true,
                  description: null,
                  type: "string",
                },
              ],
              requestSchemaId: null,
              responseSchemaId: null,
              scopes: [],
              supportsMediaUpload: false,
              supportsMediaDownload: false,
            },
          });

          const result = await Effect.runPromise(
            googleDiscoverySourceAdapter.invoke({
              source,
              capability: {} as any,
              executable: {
                id: "exe_google_gmail_list",
                bindingVersion: EXECUTABLE_BINDING_VERSION,
                binding: providerData,
              } as any,
              descriptor: {} as any,
              catalog: {} as any,
              args: {
                userId: "me",
                labelIds: ["INBOX", "UNREAD"],
              },
              auth: {
                placements: [],
                headers: {
                  authorization: "Bearer live-test-token",
                },
                queryParams: {},
                cookies: {},
                bodyValues: {},
                expiresAt: null,
                refreshAfter: null,
              },
            }),
          );

          expect(result.status).toBe(200);
          expect(result.error).toBeNull();
          expect(result.data).toEqual({
            ok: true,
            url: "/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD",
          });
          expect(requests).toHaveLength(1);
          expect(requests[0]?.url).toBe(
            "/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD",
          );
          expect(requests[0]?.headers.authorization).toBe("Bearer live-test-token");
        });
      },
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    }));
});
