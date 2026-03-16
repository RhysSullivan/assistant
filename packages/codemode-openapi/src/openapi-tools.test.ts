import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpClient,
  HttpClientResponse,
  OpenApi,
} from "@effect/platform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { describe, expect, it } from "@effect/vitest";
import { assertInclude, assertTrue } from "@effect/vitest/utils";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Schema } from "effect";

import type { ToolDefinition, ToolInput, ToolMap } from "@executor/codemode-core";

import { extractOpenApiManifest } from "./openapi-extraction";
import { createOpenApiToolsFromManifest, createOpenApiToolsFromSpec } from "./openapi-tools";

type TestServer = {
  baseUrl: string;
  requests: Array<{
    method: string;
    path: string;
    query: string;
    body: string;
    headers: Record<string, string>;
  }>;
  close: () => Promise<void>;
};

type BinaryTestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

type EffectServerHandler = {
  handler: (nodeRequest: IncomingMessage, nodeResponse: ServerResponse) => void;
  dispose: () => Promise<void>;
};

const makeEffectServerHandler = (
  requests: TestServer["requests"],
): Effect.Effect<EffectServerHandler> =>
  Effect.gen(function* () {
    const handlersLayer = HttpApiBuilder.group(GeneratedApi, "repos", (handlers) =>
      handlers
        .handle("getRepo", ({ path, urlParams }) =>
          Effect.sync(() => {
            const include = urlParams.include;
            requests.push({
              method: "GET",
              path: `/repos/${path.owner}/${path.repo}`,
              query: include ? `?include=${encodeURIComponent(include)}` : "",
              body: "",
              headers: {},
            });

            return {
              full_name: `${path.owner}/${path.repo}`,
              include: include ?? null,
            };
          }),
        )
        .handle("createIssue", ({ path, payload }) =>
          Effect.sync(() => {
            const bodyText = JSON.stringify(payload);
            requests.push({
              method: "POST",
              path: `/repos/${path.owner}/${path.repo}/issues`,
              query: "",
              body: bodyText,
              headers: {},
            });

            return {
              created: true,
              owner: path.owner,
              repo: path.repo,
              body: payload,
            };
          }),
        ),
    );

    const apiLayer = HttpApiBuilder.api(GeneratedApi).pipe(
      Layer.provide(handlersLayer),
    );

    const web = HttpApiBuilder.toWebHandler(
      Layer.mergeAll(apiLayer, NodeHttpServer.layerContext),
    );

    const handler: EffectServerHandler["handler"] = (nodeRequest, nodeResponse) => {
      void (async () => {
        const host = nodeRequest.headers.host ?? "127.0.0.1";
        const url = `http://${host}${nodeRequest.url ?? "/"}`;

        const headers = new Headers();
        for (const [key, value] of Object.entries(nodeRequest.headers)) {
          if (value === undefined) {
            continue;
          }

          if (Array.isArray(value)) {
            for (const item of value) {
              headers.append(key, item);
            }
          } else {
            headers.set(key, value);
          }
        }

        const method = nodeRequest.method ?? "GET";
        const hasBody = method !== "GET" && method !== "HEAD";
        const requestInit: RequestInit & { duplex?: "half" } = {
          method,
          headers,
        };

        if (hasBody) {
          (requestInit as { body?: unknown }).body = nodeRequest;
          requestInit.duplex = "half";
        }

        const webRequest = new Request(url, requestInit);

        const webResponse = await web.handler(webRequest);

        nodeResponse.statusCode = webResponse.status;
        webResponse.headers.forEach((value, key) => {
          nodeResponse.setHeader(key, value);
        });

        if (!webResponse.body) {
          nodeResponse.end();
          return;
        }

        const reader = webResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          nodeResponse.write(Buffer.from(value));
        }

        nodeResponse.end();
      })().catch((error: unknown) => {
        nodeResponse.statusCode = 500;
        nodeResponse.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    };

    return {
      handler,
      dispose: web.dispose,
    };
  });

const makeTestServer = Effect.acquireRelease(
  Effect.promise<TestServer>(
    () =>
      new Promise<TestServer>((resolve, reject) => {
        const requests: TestServer["requests"] = [];

        void Effect.runPromise(makeEffectServerHandler(requests))
          .then(({ handler, dispose }) => {
            const server = createServer(handler);

            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (!address || typeof address === "string") {
                reject(new Error("failed to resolve test server address"));
                return;
              }

              resolve({
                baseUrl: `http://127.0.0.1:${address.port}`,
                requests,
                close: async () => {
                  await new Promise<void>((closeResolve, closeReject) => {
                    server.close((error: Error | undefined) => {
                      if (error) {
                        closeReject(error);
                        return;
                      }
                      closeResolve();
                    });
                  });
                  await dispose();
                },
              });
            });
          })
          .catch(reject);
      }),
  ),
  (server: TestServer) =>
    Effect.tryPromise({
      try: () => server.close(),
      catch: (error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(Effect.orDie),
  );

const makeBinaryTestServer = Effect.acquireRelease(
  Effect.promise<BinaryTestServer>(
    () =>
      new Promise<BinaryTestServer>((resolve, reject) => {
        const responseBytes = Uint8Array.from([0x00, 0x7f, 0x80, 0xff]);
        const server = createServer((_, response) => {
          response.statusCode = 200;
          response.setHeader("content-type", "application/octet-stream");
          response.end(Buffer.from(responseBytes));
        });

        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Failed to bind binary OpenAPI test server"));
            return;
          }

          resolve({
            baseUrl: `http://127.0.0.1:${address.port}`,
            close: () =>
              new Promise<void>((closeResolve, closeReject) => {
                server.close((error) => {
                  if (error) {
                    closeReject(error);
                    return;
                  }
                  closeResolve();
                });
              }),
          });
        });
      }),
  ),
  (server: BinaryTestServer) =>
    Effect.tryPromise({
      try: () => server.close(),
      catch: (error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(Effect.orDie),
);

const ownerParam = HttpApiSchema.param("owner", Schema.String);
const repoParam = HttpApiSchema.param("repo", Schema.String);

const requestHeadersFromNode = (
  request: IncomingMessage,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(request.headers).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [[key, Array.isArray(value) ? value.join(",") : value]]),
  );

class GeneratedReposApi extends HttpApiGroup.make("repos")
  .add(
    HttpApiEndpoint.get("getRepo")`/repos/${ownerParam}/${repoParam}`
      .setUrlParams(
        Schema.Struct({
          include: Schema.optional(Schema.String),
        }),
      )
      .addSuccess(Schema.Unknown),
  )
  .add(
    HttpApiEndpoint.post("createIssue")`/repos/${ownerParam}/${repoParam}/issues`
      .setPayload(
        Schema.Struct({
          title: Schema.String,
        }),
      )
      .addSuccess(Schema.Unknown, { status: 201 }),
  ) {}

class GeneratedApi extends HttpApi.make("generated").add(GeneratedReposApi) {}

const generatedOpenApiSpec = OpenApi.fromApi(GeneratedApi);

const binaryReportIdParam = HttpApiSchema.param("reportId", Schema.String);

class GeneratedBinaryReportsApi extends HttpApiGroup.make("reports")
  .add(
    HttpApiEndpoint.get("getContent")`/reports/${binaryReportIdParam}/content`
      .addSuccess(HttpApiSchema.Uint8Array()),
  ) {}

class GeneratedBinaryApi extends HttpApi.make("generatedBinary")
  .add(GeneratedBinaryReportsApi) {}

const generatedBinaryOpenApiSpec = OpenApi.fromApi(GeneratedBinaryApi);

const resolveToolDefinition = (value: ToolInput): ToolDefinition =>
  typeof value === "object" && value !== null && "tool" in value
    ? value
    : { tool: value };

const resolveToolExecutor = (
  tools: ToolMap,
  path: string,
): ((args: unknown) => Promise<unknown>) => {
  const candidate = tools[path];
  if (!candidate) {
    throw new Error(`Missing tool: ${path}`);
  }

  const resolved = resolveToolDefinition(candidate);
  if (!resolved.tool.execute) {
    throw new Error(`Tool has no execute function: ${path}`);
  }

  return (args: unknown) => Promise.resolve(resolved.tool.execute?.(args));
};

describe("openapi-tools", () => {
  it.effect("extracts manifest and derives codemode tool paths", () =>
    Effect.gen(function* () {
      const manifest = yield* extractOpenApiManifest("demo", generatedOpenApiSpec);

      const tools = createOpenApiToolsFromManifest({
        manifest,
        baseUrl: "https://example.com",
        namespace: "source.demo",
        sourceKey: "api.demo",
      });

      expect(Object.keys(tools).sort()).toEqual([
        "source.demo.repos.createIssue",
        "source.demo.repos.getRepo",
      ]);

      const resolvedGet = resolveToolDefinition(tools["source.demo.repos.getRepo"]!);
      expect(resolvedGet.metadata?.sourceKey).toBe("api.demo");
      expect(resolvedGet.metadata?.providerKind).toBe("openapi");
      expect(resolvedGet.metadata?.providerData).toMatchObject({ group: "repos" });
      expect(resolvedGet.metadata?.inputSchema).toBeDefined();
    }),
  );

  it.effect("enriches extracted manifests with OpenAPI auth and response variants", () =>
    Effect.gen(function* () {
      const manifest = yield* extractOpenApiManifest("secure-demo", {
        openapi: "3.1.0",
        info: {
          title: "Secure Demo",
          version: "1.0.0",
        },
        security: [{
          bearerToken: [],
        }],
        paths: {
          "/projects/{id}": {
            get: {
              operationId: "projects.getProject",
              security: [],
              parameters: [{
                name: "id",
                in: "path",
                required: true,
                schema: {
                  type: "string",
                },
              }],
              responses: {
                "200": {
                  description: "Project",
                  content: {
                    "application/json": {
                      schema: {
                        $ref: "#/$defs/Project",
                      },
                    },
                  },
                },
                "404": {
                  description: "Missing",
                  content: {
                    "application/json": {
                      schema: {
                        $ref: "#/$defs/Missing",
                      },
                    },
                  },
                },
                default: {
                  description: "Unexpected",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          error: {
                            type: "string",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "/teams": {
            get: {
              operationId: "teams.listTeams",
              security: [
                { bearerToken: [] },
                { apiKeyHeader: [] },
              ],
              responses: {
                "200": {
                  description: "Teams",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          teams: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          securitySchemes: {
            bearerToken: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description: "Bearer access token.",
            },
            apiKeyHeader: {
              type: "apiKey",
              in: "header",
              name: "x-api-key",
            },
          },
        },
        $defs: {
          Project: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
            },
            required: ["id"],
          },
          Missing: {
            type: "object",
            properties: {
              code: {
                type: "string",
              },
            },
            required: ["code"],
          },
        },
      });

      const projectTool = manifest.tools.find((tool) => tool.toolId === "projects.getProject");
      const teamsTool = manifest.tools.find((tool) => tool.toolId === "teams.listTeams");

      expect(projectTool?.authRequirement).toEqual({
        kind: "none",
      });
      expect(projectTool?.responses?.map((response) => response.statusCode)).toEqual([
        "200",
        "default",
        "404",
      ]);
      expect(projectTool?.responses?.find((response) => response.statusCode === "404")?.schema).toMatchObject({
        $ref: "#/$defs/Missing",
      });
      expect(teamsTool?.authRequirement).toMatchObject({
        kind: "anyOf",
      });
      expect(teamsTool?.securitySchemes).toMatchObject([
        {
          schemeName: "apiKeyHeader",
          schemeType: "apiKey",
          placementIn: "header",
          placementName: "x-api-key",
        },
        {
          schemeName: "bearerToken",
          schemeType: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      ]);
      expect(Object.keys(manifest.refHintTable ?? {})).toEqual(
        expect.arrayContaining([
          "#/$defs/Project",
          "#/$defs/Missing",
        ]),
      );
    }),
  );

  it.effect("preserves OpenAPI servers, parameter serialization, and response headers", () =>
    Effect.gen(function* () {
      const manifest = yield* extractOpenApiManifest("serialized-demo", {
        openapi: "3.1.0",
        info: {
          title: "Serialized Demo",
          version: "1.0.0",
        },
        servers: [{
          url: "https://api.example.test/{version}",
          variables: {
            version: {
              default: "v1",
            },
          },
        }],
        paths: {
          "/items/{itemId}": {
            servers: [{
              url: "https://regional.example.test/base",
            }],
            get: {
              operationId: "items.getItem",
              parameters: [
                {
                  name: "itemId",
                  in: "path",
                  required: true,
                  style: "label",
                  explode: true,
                  schema: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                {
                  name: "filter",
                  in: "query",
                  style: "deepObject",
                  explode: true,
                  schema: {
                    type: "object",
                    additionalProperties: {
                      type: "string",
                    },
                  },
                },
                {
                  name: "search",
                  in: "query",
                  allowReserved: true,
                  schema: {
                    type: "string",
                  },
                },
              ],
              responses: {
                "200": {
                  description: "Item",
                  headers: {
                    "x-next-cursor": {
                      description: "Continuation cursor.",
                      schema: {
                        type: "string",
                      },
                    },
                  },
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          id: {
                            type: "string",
                          },
                        },
                        required: ["id"],
                      },
                    },
                    "text/plain": {
                      schema: {
                        type: "string",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const tool = manifest.tools.find((candidate) => candidate.toolId === "items.getItem");

      expect(tool?.documentServers).toMatchObject([
        {
          url: "https://api.example.test/{version}",
          variables: {
            version: "v1",
          },
        },
      ]);
      expect(tool?.servers).toMatchObject([
        {
          url: "https://regional.example.test/base",
        },
      ]);
      expect(tool?.invocation.parameters).toMatchObject([
        {
          name: "itemId",
          style: "label",
          explode: true,
        },
        {
          name: "filter",
          style: "deepObject",
          explode: true,
        },
        {
          name: "search",
          allowReserved: true,
        },
      ]);
      expect(tool?.responses?.[0]).toMatchObject({
        statusCode: "200",
        contentTypes: ["application/json", "text/plain"],
        headers: [
          {
            name: "x-next-cursor",
            description: "Continuation cursor.",
          },
        ],
      });
      expect(tool?.responses?.[0]?.contents).toHaveLength(2);
    }),
  );

  it.scoped("accepts OpenApi.fromApi generated specs", () =>
    Effect.gen(function* () {
      const server = yield* makeTestServer;

      const extracted = yield* createOpenApiToolsFromSpec({
        sourceName: "generated",
        openApiSpec: generatedOpenApiSpec,
        baseUrl: server.baseUrl,
        namespace: "source.generated",
      });

      expect(Object.keys(extracted.tools).sort()).toEqual([
        "source.generated.repos.createIssue",
        "source.generated.repos.getRepo",
      ]);

      const getRepo = resolveToolExecutor(extracted.tools, "source.generated.repos.getRepo");
      const result = yield* Effect.promise(() =>
        getRepo({ owner: "octocat", repo: "hello-world" }),
      );

      expect(result).toEqual({
        full_name: "octocat/hello-world",
        include: null,
      });
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.path).toBe("/repos/octocat/hello-world");
    }),
  );

  it.scoped("decodes binary HTTP responses from generated OpenAPI specs as bytes", () =>
    Effect.gen(function* () {
      const server = yield* makeBinaryTestServer;

      const extracted = yield* createOpenApiToolsFromSpec({
        sourceName: "generated-binary",
        openApiSpec: generatedBinaryOpenApiSpec,
        baseUrl: server.baseUrl,
        namespace: "source.generatedBinary",
      });

      const getContent = resolveToolExecutor(
        extracted.tools,
        "source.generatedBinary.reports.getContent",
      );
      const result = yield* Effect.promise(() =>
        getContent({ reportId: "report-123" }),
      );

      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result as Uint8Array)).toEqual([0x00, 0x7f, 0x80, 0xff]);
    }),
  );

  it.scoped("executes extracted tools against HTTP endpoint", () =>
    Effect.gen(function* () {
      const server = yield* makeTestServer;

      const extracted = yield* createOpenApiToolsFromSpec({
        sourceName: "demo",
        openApiSpec: generatedOpenApiSpec,
        baseUrl: server.baseUrl,
        namespace: "source.demo",
      });

      const getRepo = resolveToolExecutor(extracted.tools, "source.demo.repos.getRepo");
      const createIssue = resolveToolExecutor(extracted.tools, "source.demo.repos.createIssue");

      const getResult = yield* Effect.promise(() =>
        getRepo({
          path: { owner: "octocat", repo: "hello-world" },
          query: { include: "all" },
        }),
      );

      expect(getResult).toEqual({
        full_name: "octocat/hello-world",
        include: "all",
      });

      const postResult = yield* Effect.promise(() =>
        createIssue({
          owner: "octocat",
          repo: "hello-world",
          body: { title: "Bug report" },
        }),
      );

      expect(postResult).toEqual({
        created: true,
        owner: "octocat",
        repo: "hello-world",
        body: { title: "Bug report" },
      });

      const missingBody = yield* Effect.either(
        Effect.tryPromise({
          try: () =>
            createIssue({
              owner: "octocat",
              repo: "hello-world",
            }),
          catch: (error: unknown) =>
            error instanceof Error ? error : new Error(String(error)),
        }),
      );

      assertTrue(missingBody._tag === "Left");
      if (missingBody._tag === "Left" && missingBody.left instanceof Error) {
        assertInclude(missingBody.left.message, "Missing required request body");
      }

      expect(
        server.requests.map(
          (request: TestServer["requests"][number]) => request.path,
        ),
      ).toEqual([
        "/repos/octocat/hello-world",
        "/repos/octocat/hello-world/issues",
      ]);
      expect(server.requests[0]?.query).toContain("include=all");
    }),
  );

  it.scoped("serializes OpenAPI styles, allowReserved, and form bodies when invoking tools", () =>
    Effect.gen(function* () {
      const requests: TestServer["requests"] = [];
      const server = yield* Effect.acquireRelease(
        Effect.promise<TestServer>(
          () =>
            new Promise<TestServer>((resolve, reject) => {
              const httpServer = createServer((request, response) => {
                const url = new URL(
                  request.url ?? "/",
                  `http://${request.headers.host ?? "127.0.0.1"}`,
                );
                let body = "";

                request.setEncoding("utf8");
                request.on("data", (chunk) => {
                  body += chunk;
                });
                request.on("end", () => {
                  requests.push({
                    method: request.method ?? "GET",
                    path: url.pathname,
                    query: url.search,
                    body,
                    headers: requestHeadersFromNode(request),
                  });
                  response.statusCode = 200;
                  response.setHeader("content-type", "application/json");
                  response.end(JSON.stringify({ ok: true }));
                });
              });

              httpServer.once("error", reject);
              httpServer.listen(0, "127.0.0.1", () => {
                const address = httpServer.address();
                if (!address || typeof address === "string") {
                  reject(new Error("failed to resolve serialization test server address"));
                  return;
                }

                resolve({
                  baseUrl: `http://127.0.0.1:${address.port}`,
                  requests,
                  close: async () => {
                    await new Promise<void>((closeResolve, closeReject) => {
                      httpServer.close((error: Error | undefined) => {
                        if (error) {
                          closeReject(error);
                          return;
                        }
                        closeResolve();
                      });
                    });
                  },
                });
              });
            }),
        ),
        (resource) =>
          Effect.tryPromise({
            try: () => resource.close(),
            catch: (error: unknown) =>
              error instanceof Error ? error : new Error(String(error)),
          }).pipe(Effect.orDie),
      );

      const extracted = yield* createOpenApiToolsFromSpec({
        sourceName: "serialized-demo",
        openApiSpec: {
          openapi: "3.1.0",
          info: {
            title: "Serialized Demo",
            version: "1.0.0",
          },
          paths: {
            "/items/{itemId}": {
              get: {
                operationId: "items.getItem",
                parameters: [
                  {
                    name: "itemId",
                    in: "path",
                    required: true,
                    style: "label",
                    explode: true,
                    schema: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  {
                    name: "filter",
                    in: "query",
                    style: "deepObject",
                    explode: true,
                    schema: {
                      type: "object",
                      additionalProperties: {
                        type: "string",
                      },
                    },
                  },
                  {
                    name: "search",
                    in: "query",
                    allowReserved: true,
                    schema: {
                      type: "string",
                    },
                  },
                  {
                    name: "X-Trace",
                    in: "header",
                    style: "simple",
                    explode: false,
                    schema: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                ],
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            ok: {
                              type: "boolean",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "/forms": {
              post: {
                operationId: "forms.submit",
                requestBody: {
                  required: true,
                  content: {
                    "application/x-www-form-urlencoded": {
                      schema: {
                        type: "object",
                        properties: {
                          title: {
                            type: "string",
                          },
                          state: {
                            type: "string",
                          },
                        },
                        required: ["title"],
                      },
                    },
                  },
                },
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            ok: {
                              type: "boolean",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        baseUrl: server.baseUrl,
        namespace: "source.serialized",
      });

      const getItem = resolveToolExecutor(extracted.tools, "source.serialized.items.getItem");
      const submitForm = resolveToolExecutor(extracted.tools, "source.serialized.forms.submit");

      yield* Effect.promise(() =>
        getItem({
          itemId: ["alpha", "beta"],
          filter: {
            status: "open",
          },
          search: "refs/heads/main?draft=true",
          "X-Trace": ["a", "b"],
        }),
      );
      yield* Effect.promise(() =>
        submitForm({
          body: {
            title: "Bug report",
            state: "open",
          },
        }),
      );

      expect(requests[0]?.path).toBe("/items/.alpha.beta");
      expect(requests[0]?.query).toContain("filter%5Bstatus%5D=open");
      expect(requests[0]?.query).toContain("search=refs/heads/main?draft=true");
      expect(requests[0]?.headers["x-trace"]).toBe("a,b");
      expect(requests[1]?.headers["content-type"]).toContain("application/x-www-form-urlencoded");
      expect(requests[1]?.body).toContain("title=Bug+report");
      expect(requests[1]?.body).toContain("state=open");
    }),
  );

  it.effect("throws on non-2xx OpenAPI responses", () =>
    Effect.gen(function* () {
      const manifest = yield* extractOpenApiManifest("generated", generatedOpenApiSpec);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() =>
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({ error: "missing" }),
                {
                  status: 404,
                  headers: {
                    "content-type": "application/json",
                  },
                },
              ),
            ),
          ),
        ),
      );
      const tools = createOpenApiToolsFromManifest({
        manifest,
        baseUrl: "https://example.com",
        namespace: "source.generated",
        httpClientLayer,
      });
      const getRepo = resolveToolExecutor(tools, "source.generated.repos.getRepo");
      const failure = yield* Effect.either(
        Effect.tryPromise({
          try: () => getRepo({ owner: "octocat", repo: "hello-world" }),
          catch: (error: unknown) =>
            error instanceof Error ? error : new Error(String(error)),
        }),
      );

      assertTrue(failure._tag === "Left");
      if (failure._tag === "Left" && failure.left instanceof Error) {
        assertInclude(failure.left.message, "HTTP 404");
      }
    }),
  );

  it.effect("preserves base-path URLs when invoking tools", () =>
    Effect.gen(function* () {
      const manifest = yield* extractOpenApiManifest("generated", generatedOpenApiSpec);
      let capturedUrl: string | null = null;
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            capturedUrl = url.toString();

            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  full_name: "octocat/hello-world",
                  include: null,
                }),
                {
                  status: 200,
                  headers: {
                    "content-type": "application/json",
                  },
                },
              ),
            );
          })
        ),
      );
      const tools = createOpenApiToolsFromManifest({
        manifest,
        baseUrl: "https://example.com/api/v3",
        namespace: "source.generated",
        httpClientLayer,
      });
      const getRepo = resolveToolExecutor(tools, "source.generated.repos.getRepo");
      const result = yield* Effect.promise(() =>
        getRepo({ owner: "octocat", repo: "hello-world" }),
      );

      expect(result).toEqual({
        full_name: "octocat/hello-world",
        include: null,
      });

      expect(capturedUrl).toBe("https://example.com/api/v3/repos/octocat/hello-world");
    }),
  );

  it.scoped("applies credential placements for query params, cookies, and body values", () =>
    Effect.gen(function* () {
      const requests: TestServer["requests"] = [];
      const server = yield* Effect.acquireRelease(
        Effect.promise<TestServer>(
          () =>
            new Promise<TestServer>((resolve, reject) => {
              const httpServer = createServer((request, response) => {
                const url = new URL(
                  request.url ?? "/",
                  `http://${request.headers.host ?? "127.0.0.1"}`,
                );
                let body = "";

                request.setEncoding("utf8");
                request.on("data", (chunk) => {
                  body += chunk;
                });
                request.on("end", () => {
                  requests.push({
                    method: request.method ?? "GET",
                    path: url.pathname,
                    query: url.search,
                    body,
                    headers: requestHeadersFromNode(request),
                  });
                  response.statusCode = 200;
                  response.setHeader("content-type", "application/json");
                  response.end(JSON.stringify({ ok: true }));
                });
              });

              httpServer.once("error", reject);
              httpServer.listen(0, "127.0.0.1", () => {
                const address = httpServer.address();
                if (!address || typeof address === "string") {
                  reject(new Error("failed to resolve test server address"));
                  return;
                }

                resolve({
                  baseUrl: `http://127.0.0.1:${address.port}`,
                  requests,
                  close: async () => {
                    await new Promise<void>((closeResolve, closeReject) => {
                      httpServer.close((error: Error | undefined) => {
                        if (error) {
                          closeReject(error);
                          return;
                        }
                        closeResolve();
                      });
                    });
                  },
                });
              });
            }),
        ),
        (resource) =>
          Effect.tryPromise({
            try: () => resource.close(),
            catch: (error: unknown) =>
              error instanceof Error ? error : new Error(String(error)),
          }).pipe(Effect.orDie),
      );
      const extracted = yield* createOpenApiToolsFromSpec({
        sourceName: "demo",
        openApiSpec: generatedOpenApiSpec,
        baseUrl: server.baseUrl,
        namespace: "source.demo",
        credentialPlacements: {
          headers: {
            authorization: "Bearer top-secret",
          },
          queryParams: {
            api_key: "secret-key",
          },
          cookies: {
            session: "abc123",
          },
          bodyValues: {
            "auth.token": "body-secret",
          },
        },
      });

      const getRepo = resolveToolExecutor(extracted.tools, "source.demo.repos.getRepo");
      const createIssue = resolveToolExecutor(extracted.tools, "source.demo.repos.createIssue");

      yield* Effect.promise(() => getRepo({ owner: "octocat", repo: "hello-world" }));
      yield* Effect.promise(() =>
        createIssue({
          owner: "octocat",
          repo: "hello-world",
          body: { title: "Bug report" },
        }),
      );

      expect(server.requests).toHaveLength(2);
      expect(server.requests[0]?.query).toContain("api_key=secret-key");
      expect(server.requests[0]?.headers.authorization).toBe("Bearer top-secret");
      expect(server.requests[0]?.headers.cookie).toContain("session=abc123");
      expect(JSON.parse(server.requests[1]?.body ?? "{}")).toEqual({
        title: "Bug report",
        auth: {
          token: "body-secret",
        },
      });
    }),
  );

  it.scoped("falls back to path-template args when extracted path parameters are missing", () =>
    Effect.gen(function* () {
      const server = yield* makeTestServer;

      const extracted = yield* createOpenApiToolsFromSpec({
        sourceName: "generated",
        openApiSpec: generatedOpenApiSpec,
        baseUrl: server.baseUrl,
        namespace: "source.generated",
      });

      const manifestWithoutPathParameters = {
        ...extracted.manifest,
        tools: extracted.manifest.tools.map((tool) =>
          tool.toolId === "repos/getRepo"
            ? {
                ...tool,
                invocation: {
                  ...tool.invocation,
                  parameters: [],
                },
              }
            : tool),
      };

      const tools = createOpenApiToolsFromManifest({
        manifest: manifestWithoutPathParameters,
        baseUrl: server.baseUrl,
        namespace: "source.generated",
      });

      const getRepo = resolveToolExecutor(tools, "source.generated.repos.getRepo");
      const result = yield* Effect.promise(() =>
        getRepo({ owner: "octocat", repo: "hello-world" }),
      );

      expect(result).toEqual({
        full_name: "octocat/hello-world",
        include: null,
      });
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.path).toBe("/repos/octocat/hello-world");
    }),
  );

  it.effect("normalizes slash-based operationIds into grouped dotted tool paths", () =>
    Effect.gen(function* () {
      const tools = createOpenApiToolsFromManifest({
        manifest: {
          version: 2,
          sourceHash: "fixture",
          tools: [
            {
              toolId: "actions/create-workflow-dispatch",
              operationId: "actions/create-workflow-dispatch",
              tags: ["actions"],
              name: "Create workflow dispatch",
              description: null,
              method: "post",
              path: "/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
              invocation: {
                method: "post",
                pathTemplate: "/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
                parameters: [],
                requestBody: null,
              },
              operationHash: "hash_actions_create_workflow_dispatch",
            },
            {
              toolId: "users/get-authenticated",
              operationId: "users/get-authenticated",
              tags: ["users"],
              name: "Get authenticated user",
              description: null,
              method: "get",
              path: "/user",
              invocation: {
                method: "get",
                pathTemplate: "/user",
                parameters: [],
                requestBody: null,
              },
              operationHash: "hash_users_get_authenticated",
            },
          ],
        },
        baseUrl: "https://api.github.com",
        namespace: "source.github",
      });

      expect(Object.keys(tools).sort()).toEqual([
        "source.github.actions.createWorkflowDispatch",
        "source.github.users.getAuthenticated",
      ]);
    }),
  );
});
