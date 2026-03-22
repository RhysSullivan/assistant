import {
  randomUUID,
} from "node:crypto";

import {
  createMcpExpressApp,
} from "@modelcontextprotocol/sdk/server/express.js";
import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  describe,
  expect,
  it,
} from "@effect/vitest";
import {
  SourceCatalogIdSchema,
  SourceCatalogRevisionIdSchema,
  SourceIdSchema,
} from "#schema";
import type {
  Source,
  StoredSourceCatalogRevisionRecord,
  StoredSourceRecord,
} from "#schema";

import * as Effect from "effect/Effect";
import {
  z,
} from "zod/v4";

import {
  projectCatalogForAgentSdk,
} from "@executor/ir/catalog";
import type {
  CatalogSnapshotV1,
} from "@executor/ir/model";
import {
  createCatalogTypeProjector,
  projectedCatalogTypeRoots,
} from "../../catalog/catalog-typescript";
import {
  invokeIrTool,
} from "../../execution/ir-execution";
import {
  expandCatalogToolByPath,
  type LoadedSourceCatalog,
} from "../../catalog/source/runtime";
import {
  snapshotFromSourceCatalogSyncResult,
} from "../catalog-sync-result";
import {
  createSourceFromPayload,
} from "../source-definitions";
import {
  mcpSourceAdapter,
} from "./mcp";
import {
  runtimeEffectError,
} from "../../effect-errors";

type RealMcpServer = {
  endpoint: string;
  close: () => Promise<void>;
};

const makeLoadedCatalog = (input: {
  source: Source;
  snapshot: CatalogSnapshotV1;
}): LoadedSourceCatalog => {
  const catalogId = SourceCatalogIdSchema.make(`catalog_${input.source.id}`);
  const revisionId = SourceCatalogRevisionIdSchema.make(
    `catalog_revision_${input.source.id}`,
  );
  const sourceRecord = {
    id: input.source.id,
    scopeId: input.source.scopeId,
    catalogId,
    catalogRevisionId: revisionId,
    name: input.source.name,
    kind: input.source.kind,
    endpoint: input.source.endpoint,
    status: input.source.status,
    enabled: input.source.enabled,
    namespace: input.source.namespace,
    importAuthPolicy: input.source.importAuthPolicy,
    bindingConfigJson: JSON.stringify(input.source.binding),
    sourceHash: input.source.sourceHash,
    lastError: input.source.lastError,
    createdAt: input.source.createdAt,
    updatedAt: input.source.updatedAt,
  } satisfies StoredSourceRecord;
  const revision = {
    id: revisionId,
    catalogId,
    revisionNumber: 1,
    sourceConfigJson: JSON.stringify({
      kind: input.source.kind,
      endpoint: input.source.endpoint,
      binding: input.source.binding,
    }),
    importMetadataJson: JSON.stringify(input.snapshot.import),
    importMetadataHash: "hash_import",
    snapshotHash: "hash_snapshot",
    createdAt: 1,
    updatedAt: 1,
  } satisfies StoredSourceCatalogRevisionRecord;
  const projected = projectCatalogForAgentSdk({
    catalog: input.snapshot.catalog,
  });

  return {
    source: input.source,
    sourceRecord,
    revision,
    snapshot: input.snapshot,
    catalog: input.snapshot.catalog,
    projected,
    typeProjector: createCatalogTypeProjector({
      catalog: projected.catalog,
      roots: projectedCatalogTypeRoots(projected),
    }),
    importMetadata: input.snapshot.import,
  };
};

const makeRealMcpServer = Effect.acquireRelease(
  Effect.promise<RealMcpServer>(
    () =>
      new Promise<RealMcpServer>((resolve, reject) => {
        const createServerForRequest = () => {
          const mcp = new McpServer(
            {
              name: "mcp-adapter-test-server",
              version: "1.0.0",
              title: "Adapter Test Server",
              description: "Server for MCP adapter tests",
              websiteUrl: "https://example.test/mcp",
            },
            {
              capabilities: {
                tools: {
                  listChanged: true,
                },
                logging: {},
              },
            },
          );

          mcp.registerTool(
            "read_file",
            {
              title: "Read File",
              description: "Read a file from memory",
              inputSchema: {
                path: z.string(),
              },
              annotations: {
                title: "Read File (Annotated)",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
              _meta: {
                category: "filesystem",
              },
            },
            async ({ path }: { path: string }) => ({
              content: [{
                type: "text",
                text: `read:${path}`,
              }],
            }),
          );

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });

          return {
            mcp,
            transport,
          };
        };

        const app = createMcpExpressApp({ host: "127.0.0.1" });

        const handle = async (req: any, res: any, parsedBody?: unknown) => {
          const { mcp, transport } = createServerForRequest();

          try {
            await mcp.connect(transport);
            await transport.handleRequest(req, res, parsedBody);
          } finally {
            await transport.close().catch(() => undefined);
            await mcp.close().catch(() => undefined);
          }
        };

        app.post("/mcp", async (req: any, res: any) => {
          await handle(req, res, req.body);
        });

        app.get("/mcp", async (req: any, res: any) => {
          await handle(req, res);
        });

        app.delete("/mcp", async (req: any, res: any) => {
          await handle(req, res, req.body);
        });

        const listener = app.listen(0, "127.0.0.1", () => {
          const address = listener.address();
          if (!address || typeof address === "string") {
            reject(new Error("failed to resolve MCP adapter test server address"));
            return;
          }

          resolve({
            endpoint: `http://127.0.0.1:${address.port}/mcp`,
            close: async () => {
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
  (server: RealMcpServer) =>
    Effect.tryPromise({
      try: () => server.close(),
      catch: (error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(Effect.orDie),
);

const makeAuthenticatedMcpServer = (expectedAuthorization: string) =>
  Effect.acquireRelease(
    Effect.promise<RealMcpServer>(
      () =>
        new Promise<RealMcpServer>((resolve, reject) => {
          const createServerForRequest = () => {
            const mcp = new McpServer(
              {
                name: "mcp-auth-adapter-test-server",
                version: "1.0.0",
              },
              {
                capabilities: {
                  tools: {
                    listChanged: true,
                  },
                },
              },
            );

            mcp.registerTool(
              "secure_echo",
              {
                title: "Secure Echo",
                description: "Echoes a string after auth succeeds",
                inputSchema: {
                  value: z.string(),
                },
              },
              async ({ value }: { value: string }) => ({
                content: [{
                  type: "text",
                  text: `secure:${value}`,
                }],
              }),
            );

            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
            });

            return {
              mcp,
              transport,
            };
          };

          const app = createMcpExpressApp({ host: "127.0.0.1" });

          const handle = async (req: any, res: any, parsedBody?: unknown) => {
            if (req.headers.authorization !== expectedAuthorization) {
              res.status(401).json({
                jsonrpc: "2.0",
                error: {
                  code: -32001,
                  message: "Unauthorized",
                },
                id: null,
              });
              return;
            }

            const { mcp, transport } = createServerForRequest();
            try {
              await mcp.connect(transport);
              await transport.handleRequest(req, res, parsedBody);
            } finally {
              await transport.close().catch(() => undefined);
              await mcp.close().catch(() => undefined);
            }
          };

          app.post("/mcp", async (req: any, res: any) => {
            await handle(req, res, req.body);
          });

          app.get("/mcp", async (req: any, res: any) => {
            await handle(req, res);
          });

          app.delete("/mcp", async (req: any, res: any) => {
            await handle(req, res, req.body);
          });

          const listener = app.listen(0, "127.0.0.1", () => {
            const address = listener.address();
            if (!address || typeof address === "string") {
              reject(new Error("failed to resolve authenticated MCP test server address"));
              return;
            }

            resolve({
              endpoint: `http://127.0.0.1:${address.port}/mcp`,
              close: async () => {
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
    (server: RealMcpServer) =>
      Effect.tryPromise({
        try: () => server.close(),
        catch: (error: unknown) =>
          error instanceof Error ? error : new Error(String(error)),
      }).pipe(Effect.orDie),
  );

const makeStatefulMcpServer = Effect.acquireRelease(
  Effect.promise<RealMcpServer>(
    () =>
      new Promise<RealMcpServer>((resolve, reject) => {
        const transports: Record<string, StreamableHTTPServerTransport> = {};
        const servers: Record<string, McpServer> = {};

        const createServer = () => {
          let counter = 0;
          const mcp = new McpServer(
            {
              name: "mcp-stateful-test-server",
              version: "1.0.0",
            },
            {
              capabilities: {
                tools: {
                  listChanged: true,
                },
              },
            },
          );

          mcp.registerTool(
            "increment_session",
            {
              title: "Increment Session",
              description: "Increment session state",
              inputSchema: {},
            },
            async () => {
              counter += 1;
              return {
                content: [{
                  type: "text",
                  text: String(counter),
                }],
              };
            },
          );

          mcp.registerTool(
            "read_session",
            {
              title: "Read Session",
              description: "Read current session state",
              inputSchema: {},
            },
            async () => ({
              content: [{
                type: "text",
                text: String(counter),
              }],
            }),
          );

          return mcp;
        };

        const app = createMcpExpressApp({ host: "127.0.0.1" });

        app.post("/mcp", async (req: any, res: any) => {
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
                  message: error instanceof Error ? error.message : "Internal server error",
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
            reject(new Error("failed to resolve stateful MCP test server address"));
            return;
          }

          resolve({
            endpoint: `http://127.0.0.1:${address.port}/mcp`,
            close: async () => {
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
  (server: RealMcpServer) =>
    Effect.tryPromise({
      try: () => server.close(),
      catch: (error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(Effect.orDie),
);

const STDIO_TEST_SERVER_SCRIPT = `
import {
  McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StdioServerTransport,
} from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  z,
} from "zod/v4";

const server = new McpServer(
  { name: "mcp-stdio-test-server", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } } },
);

server.registerTool(
  "echo_stdio",
  {
    title: "Echo Stdio",
    description: "Echo a value over stdio",
    inputSchema: {
      value: z.string(),
    },
  },
  async ({ value }) => ({
    content: [{ type: "text", text: "stdio:" + value }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
`;

const makeStaticAuthProvider = (accessToken: string): OAuthClientProvider => ({
  get redirectUrl() {
    return "http://127.0.0.1/oauth/callback";
  },
  get clientMetadata() {
    return {
      redirect_uris: ["http://127.0.0.1/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: "Executor MCP Test",
    };
  },
  clientInformation: () => undefined,
  saveClientInformation: async () => undefined,
  tokens: async () => ({
    access_token: accessToken,
    token_type: "Bearer",
  }),
  saveTokens: async () => undefined,
  redirectToAuthorization: async () => undefined,
  saveCodeVerifier: () => undefined,
  codeVerifier: () => "unused",
  saveDiscoveryState: async () => undefined,
  discoveryState: () => undefined,
});

describe("mcp source adapter", () => {
  it.scoped("syncs MCP annotations and introspection metadata into snapshot", () =>
    Effect.gen(function* () {
      const realServer = yield* makeRealMcpServer;
      const source = yield* createSourceFromPayload({
        scopeId: "ws_test" as any,
        sourceId: SourceIdSchema.make(`src_${randomUUID()}`),
        payload: {
          name: "MCP Demo",
          kind: "mcp",
          endpoint: realServer.endpoint,
          namespace: "mcp.demo",
          binding: {
            transport: "streamable-http",
            queryParams: null,
            headers: null,
          },
          importAuthPolicy: "reuse_runtime",
          importAuth: { kind: "none" },
          auth: { kind: "none" },
          status: "connected",
          enabled: true,
        },
        now: Date.now(),
      });

      const syncResult = yield* mcpSourceAdapter.syncCatalog({
        source,
        resolveSecretMaterial: () =>
          Effect.fail(runtimeEffectError("sources/source-adapters/mcp.test", "unexpected secret lookup")),
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
      });
      const snapshot = snapshotFromSourceCatalogSyncResult(syncResult);

      const capability = Object.values(snapshot.catalog.capabilities)[0]!;
      const executable = Object.values(snapshot.catalog.executables)[0]!;
      const document = Object.values(snapshot.catalog.documents)[0]!;
      const rawManifest = document.native?.[0]?.value;

      expect(capability.surface.title).toBe("Read File");
      expect(capability.semantics).toMatchObject({
        effect: "read",
        safe: true,
        idempotent: true,
        destructive: false,
      });
      expect(capability.native).toBeUndefined();
      expect(executable.native).toBeUndefined();

      expect(typeof rawManifest).toBe("string");
      const manifest = JSON.parse(rawManifest as string) as {
        server?: {
          info?: {
            name?: string;
          };
        };
        tools?: Array<Record<string, unknown>>;
        listTools?: {
          rawResult?: {
            tools?: Array<Record<string, unknown>>;
          };
        };
      };

      expect(manifest.server?.info?.name).toBe("mcp-adapter-test-server");
      expect(manifest.tools?.[0]).toMatchObject({
        displayTitle: "Read File",
        annotations: {
          readOnlyHint: true,
        },
      });
      expect(manifest.listTools?.rawResult?.tools?.[0]).toMatchObject({
        title: "Read File",
        _meta: {
          category: "filesystem",
        },
      });
    }),
  );

  it.scoped("executes persisted MCP tools with normalized response envelopes", () =>
    Effect.gen(function* () {
      const realServer = yield* makeRealMcpServer;
      const source = yield* createSourceFromPayload({
        scopeId: "ws_test" as any,
        sourceId: SourceIdSchema.make(`src_${randomUUID()}`),
        payload: {
          name: "MCP Demo",
          kind: "mcp",
          endpoint: realServer.endpoint,
          namespace: "mcp.demo",
          binding: {
            transport: "streamable-http",
            queryParams: null,
            headers: null,
          },
          importAuthPolicy: "reuse_runtime",
          importAuth: { kind: "none" },
          auth: { kind: "none" },
          status: "connected",
          enabled: true,
        },
        now: Date.now(),
      });

      const syncResult = yield* mcpSourceAdapter.syncCatalog({
        source,
        resolveSecretMaterial: () =>
          Effect.fail(runtimeEffectError("sources/source-adapters/mcp.test", "unexpected secret lookup")),
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
      });
      const snapshot = snapshotFromSourceCatalogSyncResult(syncResult);

      const tool = yield* expandCatalogToolByPath({
        catalogs: [makeLoadedCatalog({
          source,
          snapshot,
        })],
        path: "mcp.demo.read_file",
      });

      if (!tool) {
        throw new Error("Expected MCP persisted tool to resolve");
      }

      const result = yield* invokeIrTool({
        scopeId: source.scopeId,
        actorScopeId: "acct_test" as any,
        tool,
        auth: {
          placements: [],
          headers: {},
          queryParams: {},
          cookies: {},
          bodyValues: {},
          expiresAt: null,
          refreshAfter: null,
        },
        args: {
          path: "/tmp/demo.txt",
        },
      });

      expect(result).toEqual({
        data: {
          content: [{
            type: "text",
            text: "read:/tmp/demo.txt",
          }],
        },
        error: null,
        headers: {},
        status: null,
      });
    }),
  );

  it.scoped("passes OAuth client providers through MCP sync and execution reconnects", () =>
    Effect.gen(function* () {
      const realServer = yield* makeAuthenticatedMcpServer("Bearer mcp-auth-token");
      const authProvider = makeStaticAuthProvider("mcp-auth-token");
      const source = yield* createSourceFromPayload({
        scopeId: "ws_test" as any,
        sourceId: SourceIdSchema.make(`src_${randomUUID()}`),
        payload: {
          name: "Authenticated MCP Demo",
          kind: "mcp",
          endpoint: realServer.endpoint,
          namespace: "mcp.auth.demo",
          binding: {
            transport: "streamable-http",
            queryParams: null,
            headers: null,
          },
          importAuthPolicy: "reuse_runtime",
          importAuth: { kind: "none" },
          auth: { kind: "none" },
          status: "connected",
          enabled: true,
        },
        now: Date.now(),
      });

      const resolvedAuth = {
        placements: [],
        headers: {},
        queryParams: {},
        cookies: {},
        bodyValues: {},
        expiresAt: null,
        refreshAfter: null,
        authProvider,
      } as const;

      const syncResult = yield* mcpSourceAdapter.syncCatalog({
        source,
        resolveSecretMaterial: () =>
          Effect.fail(runtimeEffectError("sources/source-adapters/mcp.test", "unexpected secret lookup")),
        resolveAuthMaterialForSlot: () => Effect.succeed(resolvedAuth),
      });
      const snapshot = snapshotFromSourceCatalogSyncResult(syncResult);

      const tool = yield* expandCatalogToolByPath({
        catalogs: [makeLoadedCatalog({
          source,
          snapshot,
        })],
        path: "mcp.auth.demo.secure_echo",
      });

      if (!tool) {
        throw new Error("Expected authenticated MCP tool to resolve");
      }

      const result = yield* invokeIrTool({
        scopeId: source.scopeId,
        actorScopeId: "acct_test" as any,
        tool,
        auth: resolvedAuth,
        args: {
          value: "ok",
        },
      });

      expect(result).toEqual({
        data: {
          content: [{
            type: "text",
            text: "secure:ok",
          }],
        },
        error: null,
        headers: {},
        status: null,
      });
    }),
  );

  it.scoped("reuses a stateful MCP session across invocations in the same run", () =>
    Effect.gen(function* () {
      const realServer = yield* makeStatefulMcpServer;
      const source = yield* createSourceFromPayload({
        scopeId: "ws_test" as any,
        sourceId: SourceIdSchema.make(`src_${randomUUID()}`),
        payload: {
          name: "Stateful MCP Demo",
          kind: "mcp",
          endpoint: realServer.endpoint,
          namespace: "mcp.stateful.demo",
          binding: {
            transport: "streamable-http",
            queryParams: null,
            headers: null,
          },
          importAuthPolicy: "reuse_runtime",
          importAuth: { kind: "none" },
          auth: { kind: "none" },
          status: "connected",
          enabled: true,
        },
        now: Date.now(),
      });

      const syncResult = yield* mcpSourceAdapter.syncCatalog({
        source,
        resolveSecretMaterial: () =>
          Effect.fail(runtimeEffectError("sources/source-adapters/mcp.test", "unexpected secret lookup")),
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
      });
      const snapshot = snapshotFromSourceCatalogSyncResult(syncResult);
      const catalog = makeLoadedCatalog({
        source,
        snapshot,
      });

      const incrementTool = yield* expandCatalogToolByPath({
        catalogs: [catalog],
        path: "mcp.stateful.demo.increment_session",
      });
      const readTool = yield* expandCatalogToolByPath({
        catalogs: [catalog],
        path: "mcp.stateful.demo.read_session",
      });

      if (!incrementTool || !readTool) {
        throw new Error("Expected stateful MCP tools to resolve");
      }

      const incrementResult = yield* invokeIrTool({
        scopeId: source.scopeId,
        actorScopeId: "acct_test" as any,
        tool: incrementTool,
        auth: {
          placements: [],
          headers: {},
          queryParams: {},
          cookies: {},
          bodyValues: {},
          expiresAt: null,
          refreshAfter: null,
        },
        args: {},
        context: {
          runId: "exec_mcp_stateful",
        },
      });

      const readResult = yield* invokeIrTool({
        scopeId: source.scopeId,
        actorScopeId: "acct_test" as any,
        tool: readTool,
        auth: {
          placements: [],
          headers: {},
          queryParams: {},
          cookies: {},
          bodyValues: {},
          expiresAt: null,
          refreshAfter: null,
        },
        args: {},
        context: {
          runId: "exec_mcp_stateful",
        },
      });

      expect(incrementResult).toEqual({
        data: {
          content: [{
            type: "text",
            text: "1",
          }],
        },
        error: null,
        headers: {},
        status: null,
      });
      expect(readResult).toEqual({
        data: {
          content: [{
            type: "text",
            text: "1",
          }],
        },
        error: null,
        headers: {},
        status: null,
      });
    }),
  );

  it.scoped("supports stdio MCP sources", () =>
    Effect.gen(function* () {
      const source = yield* createSourceFromPayload({
        scopeId: "ws_test" as any,
        sourceId: SourceIdSchema.make(`src_${randomUUID()}`),
        payload: {
          name: "Stdio MCP Demo",
          kind: "mcp",
          endpoint: "stdio://local/mcp-stdio-demo",
          namespace: "mcp.stdio.demo",
          binding: {
            transport: "stdio",
            queryParams: null,
            headers: null,
            command: "node",
            args: ["--input-type=module", "-e", STDIO_TEST_SERVER_SCRIPT],
            env: null,
            cwd: process.cwd(),
          },
          importAuthPolicy: "reuse_runtime",
          importAuth: { kind: "none" },
          auth: { kind: "none" },
          status: "connected",
          enabled: true,
        },
        now: Date.now(),
      });

      const syncResult = yield* mcpSourceAdapter.syncCatalog({
        source,
        resolveSecretMaterial: () =>
          Effect.fail(runtimeEffectError("sources/source-adapters/mcp.test", "unexpected secret lookup")),
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
      });
      const snapshot = snapshotFromSourceCatalogSyncResult(syncResult);

      const tool = yield* expandCatalogToolByPath({
        catalogs: [makeLoadedCatalog({
          source,
          snapshot,
        })],
        path: "mcp.stdio.demo.echo_stdio",
      });

      if (!tool) {
        throw new Error("Expected stdio MCP tool to resolve");
      }

      const result = yield* invokeIrTool({
        scopeId: source.scopeId,
        actorScopeId: "acct_test" as any,
        tool,
        auth: {
          placements: [],
          headers: {},
          queryParams: {},
          cookies: {},
          bodyValues: {},
          expiresAt: null,
          refreshAfter: null,
        },
        args: {
          value: "ok",
        },
        context: {
          runId: "exec_mcp_stdio",
        },
      });

      expect(result).toEqual({
        data: {
          content: [{
            type: "text",
            text: "stdio:ok",
          }],
        },
        error: null,
        headers: {},
        status: null,
      });
    }),
  );
});
