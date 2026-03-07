import { randomUUID } from "node:crypto";

import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpServer,
} from "@effect/platform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it } from "@effect/vitest";
import {
  AccountIdSchema,
  ExecutionIdSchema,
  SecretMaterialIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { Schema } from "effect";
import { z } from "zod/v4";

import {
  createSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "#persistence";
import type { SourceId, WorkspaceId } from "#schema";

import {
  createRuntimeSourceAuthService,
  type RuntimeSourceAuthService,
} from "./source-auth-service";
import { createLiveExecutionManager } from "./live-execution";
import { createWorkspaceExecutionEnvironmentResolver } from "./workspace-execution-environment";

type CountedMcpServer = {
  endpoint: string;
  counts: {
    listTools: number;
    callTool: number;
  };
  close: () => Promise<void>;
};

type OpenApiSpecServer = {
  baseUrl: string;
  specUrl: string;
  seenAuthHeaders: Array<string | null>;
  close: () => Promise<void>;
};

const closeScope = (scope: Scope.CloseableScope) =>
  Scope.close(scope, Exit.void).pipe(Effect.orDie);

const makePersistence = Effect.acquireRelease(
  createSqlControlPlanePersistence({
    localDataDir: ":memory:",
  }),
  (persistence) =>
    Effect.tryPromise({
      try: () => persistence.close(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.orDie),
);

const makeCountedMcpServer = Effect.acquireRelease(
  Effect.promise<CountedMcpServer>(
    () =>
      new Promise<CountedMcpServer>((resolve, reject) => {
        const counts = {
          listTools: 0,
          callTool: 0,
        };
        let closed = false;
        const app = createMcpExpressApp({ host: "127.0.0.1" });
        const transports: Record<string, StreamableHTTPServerTransport> = {};
        const servers: Record<string, McpServer> = {};

        const createServer = () => {
          const server = new McpServer(
            {
              name: "workspace-execution-environment-test-server",
              version: "1.0.0",
            },
            {
              capabilities: {
                tools: {},
              },
            },
          );

          server.registerTool(
            "echo",
            {
              description: "Echo the provided string",
              inputSchema: {
                value: z.string(),
              },
            },
            async ({ value }: { value: string }) => ({
              content: [{ type: "text", text: `echo:${value}` }],
            }),
          );

          return server;
        };

        const countMethods = (body: unknown) => {
          const payloads = Array.isArray(body) ? body : [body];
          for (const payload of payloads) {
            if (!payload || typeof payload !== "object") {
              continue;
            }

            const method = "method" in payload ? payload.method : undefined;
            if (method === "tools/list") {
              counts.listTools += 1;
            } else if (method === "tools/call") {
              counts.callTool += 1;
            }
          }
        };

        app.post("/mcp", async (req: any, res: any) => {
          countMethods(req.body);

          const sessionIdHeader = req.headers["mcp-session-id"];
          const sessionId =
            typeof sessionIdHeader === "string"
              ? sessionIdHeader
              : Array.isArray(sessionIdHeader)
                ? sessionIdHeader[0]
                : undefined;

          try {
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
              transport = transports[sessionId];
            } else {
              transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (newSessionId) => {
                  transports[newSessionId] = transport;
                },
              });

              transport.onclose = () => {
                const closedSessionId = transport.sessionId;
                if (closedSessionId && transports[closedSessionId]) {
                  delete transports[closedSessionId];
                }
                if (closedSessionId && servers[closedSessionId]) {
                  void servers[closedSessionId].close().catch(() => undefined);
                  delete servers[closedSessionId];
                }
              };

              const server = createServer();
              await server.connect(transport);
              const newSessionId = transport.sessionId;
              if (newSessionId) {
                servers[newSessionId] = server;
              }
            }

            await transport.handleRequest(req, res, req.body);
          } catch (error) {
            if (!res.headersSent) {
              res.status(500).json({
                jsonrpc: "2.0",
                error: {
                  code: -32603,
                  message:
                    error instanceof Error ? error.message : "Internal server error",
                },
                id: null,
              });
            }
          }
        });

        app.get("/mcp", async (req: any, res: any) => {
          const sessionIdHeader = req.headers["mcp-session-id"];
          const sessionId =
            typeof sessionIdHeader === "string"
              ? sessionIdHeader
              : Array.isArray(sessionIdHeader)
                ? sessionIdHeader[0]
                : undefined;

          if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
          }

          await transports[sessionId].handleRequest(req, res);
        });

        app.delete("/mcp", async (req: any, res: any) => {
          const sessionIdHeader = req.headers["mcp-session-id"];
          const sessionId =
            typeof sessionIdHeader === "string"
              ? sessionIdHeader
              : Array.isArray(sessionIdHeader)
                ? sessionIdHeader[0]
                : undefined;

          if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
          }

          const transport = transports[sessionId];
          await transport.handleRequest(req, res, req.body);
          await transport.close();
          delete transports[sessionId];

          if (servers[sessionId]) {
            await servers[sessionId].close().catch(() => undefined);
            delete servers[sessionId];
          }
        });

        const listener = app.listen(0, "127.0.0.1", () => {
          const address = listener.address();
          if (!address || typeof address === "string") {
            reject(new Error("failed to resolve MCP test server address"));
            return;
          }

          resolve({
            endpoint: `http://127.0.0.1:${address.port}/mcp`,
            counts,
            close: async () => {
              if (closed) {
                return;
              }
              closed = true;

              for (const transport of Object.values(transports)) {
                await transport.close().catch(() => undefined);
              }

              for (const server of Object.values(servers)) {
                await server.close().catch(() => undefined);
              }

              await new Promise<void>((closeResolve, closeReject) => {
                listener.close((error: Error | undefined) => {
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

        listener.once("error", reject);
      }),
  ),
  (server) =>
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
      .addSuccess(
        Schema.Struct({
          ok: Schema.Boolean,
          full_name: Schema.String,
        }),
      ),
  ) {}

class GeneratedApi extends HttpApi.make("generated").add(GeneratedReposApi) {}

const makeOpenApiSpecServer = Effect.acquireRelease(
  Effect.gen(function* () {
    const seenAuthHeaders: OpenApiSpecServer["seenAuthHeaders"] = [];
    const handlersLayer = HttpApiBuilder.group(GeneratedApi, "repos", (handlers) =>
      handlers.handle("getRepo", ({ path, request }) =>
        Effect.sync(() => {
          seenAuthHeaders.push(
            typeof request.headers.authorization === "string"
              ? request.headers.authorization
              : null,
          );

          return {
            ok: true,
            full_name: `${path.owner}/${path.repo}`,
          };
        })
      )
    );
    const apiLayer = HttpApiBuilder.api(GeneratedApi).pipe(
      Layer.provide(handlersLayer),
    );
    const serverLayer = HttpApiBuilder.serve().pipe(
      Layer.provide(HttpApiBuilder.middlewareOpenApi()),
      Layer.provide(apiLayer),
      Layer.provideMerge(NodeHttpServer.layerTest),
    );
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(serverLayer, scope).pipe(
      Effect.catchAll((error) =>
        closeScope(scope).pipe(
          Effect.zipRight(Effect.fail(error)),
        )),
    );
    const server = Context.get(context, HttpServer.HttpServer);
    const baseUrl = HttpServer.formatAddress(server.address);

    return {
      baseUrl,
      specUrl: new URL("/openapi.json", baseUrl).toString(),
      seenAuthHeaders,
      close: () => Effect.runPromise(closeScope(scope)),
    } satisfies OpenApiSpecServer;
  }),
  (server) =>
    Effect.tryPromise({
      try: () => server.close(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.orDie),
);

const persistConnectedEchoTool = (input: {
  persistence: SqlControlPlanePersistence;
  endpoint: string;
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.gen(function* () {
    const now = Date.now();

    yield* input.persistence.rows.sources.insert({
      id: input.sourceId,
      workspaceId: input.workspaceId,
      name: "Counted MCP",
      kind: "mcp",
      endpoint: input.endpoint,
      status: "connected",
      enabled: true,
      namespace: "counted",
      transport: "auto",
      queryParamsJson: null,
      headersJson: null,
      specUrl: null,
      defaultHeadersJson: null,
      authKind: "none",
      authHeaderName: null,
      authPrefix: null,
      sourceHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    yield* input.persistence.rows.toolArtifacts.replaceForSource({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      artifacts: [{
        artifact: {
          workspaceId: input.workspaceId,
          path: "counted.echo",
          toolId: "echo",
          sourceId: input.sourceId,
          title: "echo",
          description: "Echo the provided string",
          searchNamespace: "counted.echo",
          searchText: "counted.echo echo provided string",
          inputSchemaJson: JSON.stringify({
            type: "object",
            properties: {
              value: {
                type: "string",
              },
            },
            required: ["value"],
            additionalProperties: false,
          }),
          outputSchemaJson: null,
          providerKind: "mcp",
          mcpToolName: "echo",
          openApiMethod: null,
          openApiPathTemplate: null,
          openApiOperationHash: null,
          openApiRequestBodyRequired: null,
          createdAt: now,
          updatedAt: now,
        },
      }],
    });
  });

const persistConnectedGithubSearchArtifacts = (input: {
  persistence: SqlControlPlanePersistence;
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.gen(function* () {
    const now = Date.now();

    yield* input.persistence.rows.sources.insert({
      id: input.sourceId,
      workspaceId: input.workspaceId,
      name: "GitHub",
      kind: "openapi",
      endpoint: "https://api.github.com",
      status: "connected",
      enabled: true,
      namespace: "github",
      transport: null,
      queryParamsJson: null,
      headersJson: null,
      specUrl: "https://example.com/github-openapi.json",
      defaultHeadersJson: null,
      authKind: "none",
      authHeaderName: null,
      authPrefix: null,
      sourceHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    yield* input.persistence.rows.toolArtifacts.replaceForSource({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      artifacts: [
        {
          artifact: {
            workspaceId: input.workspaceId,
            path: "github.actions/get-environment-secret",
            toolId: "actions/get-environment-secret",
            sourceId: input.sourceId,
            title: "Get an environment secret",
            description:
              "Gets a single environment secret without revealing its encrypted value. Authenticated users must have collaborator access to a repository to create, update, or read secrets.",
            searchNamespace: "github.actions",
            searchText:
              "github.actions/get-environment-secret github.actions get an environment secret gets a single environment secret without revealing its encrypted value authenticated users must have collaborator access to a repository to create update or read secrets GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}",
            inputSchemaJson: null,
            outputSchemaJson: null,
            providerKind: "openapi",
            mcpToolName: null,
            openApiMethod: "get",
            openApiPathTemplate: "/repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}",
            openApiOperationHash: "op_actions_get_environment_secret",
            openApiRequestBodyRequired: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          artifact: {
            workspaceId: input.workspaceId,
            path: "github.actions/get-self-hosted-runner-for-org",
            toolId: "actions/get-self-hosted-runner-for-org",
            sourceId: input.sourceId,
            title: "Get a self-hosted runner for an organization",
            description:
              "Gets a specific self-hosted runner configured in an organization. Authenticated users must have admin access to the organization to use this endpoint.",
            searchNamespace: "github.actions",
            searchText:
              "github.actions/get-self-hosted-runner-for-org github.actions get a self hosted runner for an organization gets a specific self hosted runner configured in an organization authenticated users must have admin access to the organization to use this endpoint GET /orgs/{org}/actions/runners/{runner_id}",
            inputSchemaJson: null,
            outputSchemaJson: null,
            providerKind: "openapi",
            mcpToolName: null,
            openApiMethod: "get",
            openApiPathTemplate: "/orgs/{org}/actions/runners/{runner_id}",
            openApiOperationHash: "op_actions_get_self_hosted_runner_for_org",
            openApiRequestBodyRequired: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          artifact: {
            workspaceId: input.workspaceId,
            path: "github.users/get-authenticated",
            toolId: "users/get-authenticated",
            sourceId: input.sourceId,
            title: "Get the authenticated user",
            description:
              "Gets the authenticated user. OAuth app tokens and personal access tokens need the user scope to include private profile information.",
            searchNamespace: "github.users",
            searchText:
              "github.users/get-authenticated github.users get the authenticated user gets the authenticated user oauth app tokens and personal access tokens need the user scope to include private profile information GET /user",
            inputSchemaJson: null,
            outputSchemaJson: null,
            providerKind: "openapi",
            mcpToolName: null,
            openApiMethod: "get",
            openApiPathTemplate: "/user",
            openApiOperationHash: "op_users_get_authenticated",
            openApiRequestBodyRequired: null,
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    });
  });

const makeResolver = (persistence: SqlControlPlanePersistence) =>
  createWorkspaceExecutionEnvironmentResolver({
    rows: persistence.rows,
    sourceAuthService: {
      getLocalServerBaseUrl: () => null,
      storeSecretMaterial: () => Effect.fail(new Error("not implemented in test")),
      getSourceById: () => Effect.fail(new Error("not implemented in test")),
      addExecutorSource: () => Effect.fail(new Error("not implemented in test")),
      completeSourceCredentialSetup: () => Effect.fail(new Error("not implemented in test")),
    } as RuntimeSourceAuthService,
  });

const makeResolverWithLiveSourceAuth = (persistence: SqlControlPlanePersistence) =>
  createWorkspaceExecutionEnvironmentResolver({
    rows: persistence.rows,
    sourceAuthService: createRuntimeSourceAuthService({
      rows: persistence.rows,
      liveExecutionManager: createLiveExecutionManager(),
      getLocalServerBaseUrl: () => "http://127.0.0.1:8788",
    }),
  });

describe("workspace-execution-environment", () => {
  it.scoped("discovers persisted tools without live MCP listing", () =>
    Effect.gen(function* () {
      const server = yield* makeCountedMcpServer;
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_catalog");
      const sourceId = SourceIdSchema.make("src_catalog");
      yield* persistConnectedEchoTool({
        persistence,
        endpoint: server.endpoint,
        workspaceId,
        sourceId,
      });

      yield* Effect.tryPromise({
        try: () => server.close(),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.orDie);

      const resolveEnvironment = makeResolver(persistence);
      const environment = yield* resolveEnvironment({
        workspaceId,
        accountId: AccountIdSchema.make("acc_catalog"),
        executionId: ExecutionIdSchema.make("exec_catalog"),
      });

      const discovered = (yield* environment.toolInvoker.invoke({
        path: "discover",
        args: {
          query: "echo string",
          limit: 5,
        },
      })) as {
        bestPath: string | null;
        total: number;
        results: Array<{ path: string }>;
      };

      expect(discovered.bestPath).toBe("counted.echo");
      expect(discovered.total).toBeGreaterThan(0);
      expect(server.counts.listTools).toBe(0);
      expect(server.counts.callTool).toBe(0);
    }),
  );

  it.scoped("prefers namespace and path matches over noisy GitHub boilerplate", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_github_discovery");
      const sourceId = SourceIdSchema.make("src_github_discovery");
      yield* persistConnectedGithubSearchArtifacts({
        persistence,
        workspaceId,
        sourceId,
      });

      const resolveEnvironment = makeResolver(persistence);
      const environment = yield* resolveEnvironment({
        workspaceId,
        accountId: AccountIdSchema.make("acc_github_discovery"),
        executionId: ExecutionIdSchema.make("exec_github_discovery"),
      });

      const firstQuery = (yield* environment.toolInvoker.invoke({
        path: "discover",
        args: {
          query: "get authenticated user",
          limit: 5,
        },
      })) as {
        bestPath: string | null;
        results: Array<{ path: string }>;
      };

      expect(firstQuery.bestPath).toBe("github.users/get-authenticated");
      expect(firstQuery.results[0]?.path).toBe("github.users/get-authenticated");

      const secondQuery = (yield* environment.toolInvoker.invoke({
        path: "discover",
        args: {
          query: "users get myself current user profile",
          limit: 5,
        },
      })) as {
        bestPath: string | null;
        results: Array<{ path: string }>;
      };

      expect(secondQuery.bestPath).toBe("github.users/get-authenticated");
      expect(secondQuery.results[0]?.path).toBe("github.users/get-authenticated");
    }),
  );

  it.scoped("invokes persisted MCP tools on demand without re-listing", () =>
    Effect.gen(function* () {
      const server = yield* makeCountedMcpServer;
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_invoke");
      const sourceId = SourceIdSchema.make("src_invoke");
      yield* persistConnectedEchoTool({
        persistence,
        endpoint: server.endpoint,
        workspaceId,
        sourceId,
      });

      const resolveEnvironment = makeResolver(persistence);
      const environment = yield* resolveEnvironment({
        workspaceId,
        accountId: AccountIdSchema.make("acc_invoke"),
        executionId: ExecutionIdSchema.make("exec_invoke"),
      });

      const result = (yield* environment.toolInvoker.invoke({
        path: "counted.echo",
        args: {
          value: "hello",
        },
      })) as {
        content?: Array<{ text?: string }>;
      };

      expect(server.counts.listTools).toBe(0);
      expect(server.counts.callTool).toBe(1);
      expect(result.content?.[0]?.text).toBe("echo:hello");
    }),
  );

  it.scoped("adds an OpenAPI source through executor.sources.add with elicited credentials", () =>
    Effect.gen(function* () {
      const specServer = yield* makeOpenApiSpecServer;
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_add_openapi");
      const resolveEnvironment = makeResolverWithLiveSourceAuth(persistence);
      const now = Date.now();
      const tokenSecretMaterialId = SecretMaterialIdSchema.make(
        "sec_test_openapi_bearer",
      );
      yield* persistence.rows.secretMaterials.upsert({
        id: tokenSecretMaterialId,
        purpose: "auth_material",
        value: "ghp_test_token",
        createdAt: now,
        updatedAt: now,
      });
      let capturedElicitation:
        | {
            mode?: string;
            url?: string;
            elicitationId?: string;
          }
        | null = null;

      const environment = yield* resolveEnvironment({
        workspaceId,
        accountId: AccountIdSchema.make("acc_add_openapi"),
        executionId: ExecutionIdSchema.make("exec_add_openapi"),
        onElicitation: (request) =>
          Effect.sync(() => {
            capturedElicitation = request.elicitation as {
              mode?: string;
              url?: string;
              elicitationId?: string;
            };

            return {
              action: "accept" as const,
              content: {
                authKind: "bearer",
                tokenSecretMaterialId,
              },
            };
          }),
      });

      const added = (yield* environment.toolInvoker.invoke({
        path: "executor.sources.add",
        args: {
          kind: "openapi",
          endpoint: specServer.baseUrl,
          specUrl: specServer.specUrl,
          name: "GitHub",
          namespace: "github",
        },
        context: {
          runId: "exec_add_openapi",
        },
      })) as {
        kind: string;
        status: string;
        auth: {
          kind: string;
          token?: {
            providerId: string;
          };
        };
      };

      expect(added.kind).toBe("openapi");
      expect(added.status).toBe("connected");
      expect(added.auth.kind).toBe("bearer");
      expect(added.auth.token?.providerId).toBe("control-plane");
      expect(capturedElicitation).toMatchObject({
        mode: "url",
        url: expect.stringContaining("/v1/workspaces/"),
        elicitationId: expect.stringContaining("executor.sources.add:"),
      });
      expect((capturedElicitation as { url?: string } | null)?.url).toContain(
        encodeURIComponent("exec_add_openapi:executor.sources.add:"),
      );

      const storedArtifacts = yield* persistence.rows.toolArtifacts.listByWorkspaceId(
        workspaceId,
      );
      expect(storedArtifacts.length).toBeGreaterThan(0);
      const repoToolPath = storedArtifacts[0]!.path;

      const freshEnvironment = yield* resolveEnvironment({
        workspaceId,
        accountId: AccountIdSchema.make("acc_add_openapi_fresh"),
        executionId: ExecutionIdSchema.make("exec_add_openapi_fresh"),
      });

      const discovered = (yield* freshEnvironment.toolInvoker.invoke({
        path: "discover",
        args: {
          query: "github repo",
          limit: 5,
        },
      })) as {
        bestPath: string | null;
      };

      expect(discovered.bestPath).toBe(repoToolPath);

      const invoked = (yield* freshEnvironment.toolInvoker.invoke({
        path: repoToolPath,
        args: {
          owner: "vercel",
          repo: "ai",
        },
      })) as {
        status: number;
        body: {
          ok: boolean;
          full_name: string;
        };
      };

      expect(invoked.status).toBe(200);
      expect(invoked.body).toEqual({
        ok: true,
        full_name: "vercel/ai",
      });
      expect(specServer.seenAuthHeaders).toEqual(["Bearer ghp_test_token"]);
    }),
  );

  it.scoped("describes executor.sources.add with derived type info and schemas", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const resolveEnvironment = makeResolverWithLiveSourceAuth(persistence);

      const environment = yield* resolveEnvironment({
        workspaceId: WorkspaceIdSchema.make("ws_describe_add_source"),
        accountId: AccountIdSchema.make("acc_describe_add_source"),
        executionId: ExecutionIdSchema.make("exec_describe_add_source"),
      });

      const described = (yield* environment.toolInvoker.invoke({
        path: "describe.tool",
        args: {
          path: "executor.sources.add",
          includeSchemas: true,
        },
      })) as {
        path: string;
        description?: string;
        inputHint?: string;
        inputSchemaJson?: string;
      } | null;

      expect(described?.path).toBe("executor.sources.add");
      expect(described?.description).toContain("Source add input shapes:");
      expect(described?.description).toContain("specUrl");
      expect(described?.description).toContain("credential setup");
      expect(described?.inputHint).toContain("endpoint");
      expect(described?.inputHint).not.toContain("auth");

      const inputSchema = described?.inputSchemaJson
        ? JSON.parse(described.inputSchemaJson) as Record<string, unknown>
        : null;
      expect(inputSchema).not.toBeNull();
      expect(JSON.stringify(inputSchema)).toContain("specUrl");
      expect(JSON.stringify(inputSchema)).toContain("endpoint");
      expect(JSON.stringify(inputSchema)).not.toContain("\"auth\"");
    }),
  );
});
