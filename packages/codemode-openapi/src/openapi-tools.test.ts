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

import type { ToolDefinition, ToolInput, ToolMap } from "@executor-v3/codemode-core";

import { extractOpenApiManifest } from "./openapi-extraction";
import { createOpenApiToolsFromManifest, createOpenApiToolsFromSpec } from "./openapi-tools";

type TestServer = {
  baseUrl: string;
  requests: Array<{
    method: string;
    path: string;
    query: string;
    body: string;
  }>;
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

const ownerParam = HttpApiSchema.param("owner", Schema.String);
const repoParam = HttpApiSchema.param("repo", Schema.String);

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
      expect(resolvedGet.metadata?.providerDataJson).toContain('"group":"repos"');
      expect(resolvedGet.metadata?.inputSchemaJson).toBeDefined();
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
