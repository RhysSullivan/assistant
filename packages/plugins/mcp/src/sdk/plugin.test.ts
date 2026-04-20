import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { createExecutor, makeTestConfig, Scope, ScopeId } from "@executor/sdk";

import { mcpPlugin } from "./plugin";
import {
  extractManifestFromListToolsResult,
  deriveMcpNamespace,
  joinToolPath,
} from "./manifest";

// ---------------------------------------------------------------------------
// Manifest extraction
// ---------------------------------------------------------------------------

describe("extractManifestFromListToolsResult", () => {
  it.effect("extracts tools from a valid listTools response", () =>
    Effect.sync(() => {
      const result = extractManifestFromListToolsResult({
        tools: [
          {
            name: "get_weather",
            description: "Get weather for a location",
            inputSchema: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
          { name: "search", description: "Search the web" },
        ],
      });

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0]!.toolName).toBe("get_weather");
      expect(result.tools[0]!.toolId).toBe("get_weather");
      expect(result.tools[0]!.description).toBe("Get weather for a location");
      expect(result.tools[1]!.toolName).toBe("search");
    }),
  );

  it.effect("sanitizes tool IDs", () =>
    Effect.sync(() => {
      const result = extractManifestFromListToolsResult({
        tools: [
          { name: "My Tool!!", description: null },
          { name: "My Tool!!", description: null },
        ],
      });

      expect(result.tools[0]!.toolId).toBe("my_tool");
      expect(result.tools[1]!.toolId).toBe("my_tool_2");
    }),
  );

  it.effect("handles empty tools list", () =>
    Effect.sync(() => {
      const result = extractManifestFromListToolsResult({ tools: [] });
      expect(result.tools).toHaveLength(0);
    }),
  );

  it.effect("extracts server metadata", () =>
    Effect.sync(() => {
      const result = extractManifestFromListToolsResult(
        { tools: [] },
        { serverInfo: { name: "test-server", version: "1.0.0" } },
      );
      expect(result.server?.name).toBe("test-server");
      expect(result.server?.version).toBe("1.0.0");
    }),
  );
});

// ---------------------------------------------------------------------------
// Namespace derivation
// ---------------------------------------------------------------------------

describe("deriveMcpNamespace", () => {
  it.effect("derives from name", () =>
    Effect.sync(() => {
      expect(deriveMcpNamespace({ name: "GitHub MCP" })).toBe("github_mcp");
    }),
  );

  it.effect("derives from endpoint", () =>
    Effect.sync(() => {
      expect(deriveMcpNamespace({ endpoint: "https://api.example.com/mcp" })).toBe(
        "api_example_com",
      );
    }),
  );

  it.effect("derives from command", () =>
    Effect.sync(() => {
      expect(deriveMcpNamespace({ command: "/usr/local/bin/my-mcp-server" })).toBe(
        "my_mcp_server",
      );
    }),
  );

  it.effect("falls back to 'mcp'", () =>
    Effect.sync(() => {
      expect(deriveMcpNamespace({})).toBe("mcp");
    }),
  );
});

// ---------------------------------------------------------------------------
// joinToolPath
// ---------------------------------------------------------------------------

describe("joinToolPath", () => {
  it.effect("joins namespace and toolId", () =>
    Effect.sync(() => {
      expect(joinToolPath("github", "search")).toBe("github.search");
    }),
  );

  it.effect("returns toolId when namespace is undefined", () =>
    Effect.sync(() => {
      expect(joinToolPath(undefined, "search")).toBe("search");
    }),
  );
});

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

describe("mcpPlugin", () => {
  it.effect("creates executor with mcp plugin", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [mcpPlugin()] as const,
        }),
      );

      expect(executor.mcp).toBeDefined();
      expect(executor.mcp.addSource).toBeTypeOf("function");
      expect(executor.mcp.removeSource).toBeTypeOf("function");
      expect(executor.mcp.refreshSource).toBeTypeOf("function");
      expect(executor.mcp.probeEndpoint).toBeTypeOf("function");
      expect(executor.mcp.startOAuth).toBeTypeOf("function");
      expect(executor.mcp.completeOAuth).toBeTypeOf("function");
    }),
  );

  it.effect("sources list is initially empty", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [mcpPlugin()] as const }),
      );
      const sources = yield* executor.sources.list();
      expect(sources).toHaveLength(0);
    }),
  );

  it.effect("tools list is initially empty", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [mcpPlugin()] as const }),
      );
      const tools = yield* executor.tools.list();
      expect(tools).toHaveLength(0);
    }),
  );

  // When discovery fails (auth, network, etc.) we still want the source
  // row to land in the DB so users see it in the catalog — they can
  // retry via refresh once they fix the underlying problem. The error
  // still propagates to the caller so boot-time sync logs the reason.
  it.effect("registers source with 0 tools when discovery fails", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [mcpPlugin()] as const }),
      );

      const result = yield* executor.mcp
        .addSource({
          transport: "remote",
          scope: "test-scope",
          name: "broken",
          // Port 1 is reserved — will connection-refused immediately,
          // giving us a deterministic discovery failure without any
          // server mocks.
          endpoint: "http://127.0.0.1:1/mcp",
          remoteTransport: "auto",
          namespace: "broken_source",
        })
        .pipe(Effect.either);

      expect(result._tag).toBe("Left");

      const sources = yield* executor.sources.list();
      const broken = sources.find((s) => s.id === "broken_source");
      expect(broken).toBeDefined();
      expect(broken?.kind).toBe("mcp");
      expect(broken?.pluginId).toBe("mcp");

      const tools = yield* executor.tools.list();
      expect(tools.filter((t) => t.sourceId === "broken_source")).toHaveLength(0);
    }),
  );

  // -------------------------------------------------------------------------
  // Multi-scope shadowing — regression suite covering the bug class where
  // store reads/writes that don't pin scope_id collapse onto whichever row
  // the scoped adapter's `scope_id IN (stack)` filter sees first. Each
  // scenario is reproducible against the pre-fix store.
  //
  // MCP discovery runs on addSource against an unreachable endpoint so
  // both addSource calls fail discovery but still persist the source row
  // (the behavior the "registers source with 0 tools" test above relies
  // on). This gives us two rows at the same namespace across two scopes
  // without needing an in-test MCP server.
  // -------------------------------------------------------------------------

  const ORG_SCOPE = ScopeId.make("org-scope");
  const USER_SCOPE = ScopeId.make("user-scope");

  const stackedScopes = [
    new Scope({ id: USER_SCOPE, name: "user", createdAt: new Date() }),
    new Scope({ id: ORG_SCOPE, name: "org", createdAt: new Date() }),
  ] as const;

  // `seedShadowed` wraps `executor.mcp.addSource` at a given scope with
  // a broken endpoint. Discovery fails (port 1 is reserved) so the call
  // returns Left, but the source row still lands — exactly the
  // "registers source with 0 tools when discovery fails" behavior above.
  // We use `Effect.either` so the outer `yield*` never fails the test.
  const seedShadowed = (
    addSource: (c: {
      readonly transport: "remote";
      readonly scope: string;
      readonly name: string;
      readonly endpoint: string;
      readonly remoteTransport: "auto";
      readonly namespace: string;
    }) => Effect.Effect<unknown, unknown>,
    args: { readonly scope: string; readonly name: string; readonly endpoint: string },
  ) =>
    addSource({
      transport: "remote",
      scope: args.scope,
      name: args.name,
      endpoint: args.endpoint,
      remoteTransport: "auto",
      namespace: "shared",
    }).pipe(Effect.either);

  it.effect("shadowed addSource does not wipe the outer-scope source", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          scopes: stackedScopes,
          plugins: [mcpPlugin()] as const,
        }),
      );

      // Org-level base source — discovery fails but row persists.
      yield* seedShadowed(executor.mcp.addSource, {
        scope: ORG_SCOPE as string,
        name: "Org Source",
        endpoint: "http://127.0.0.1:1/org-mcp",
      });

      // Per-user shadow with the same namespace.
      yield* seedShadowed(executor.mcp.addSource, {
        scope: USER_SCOPE as string,
        name: "User Source",
        endpoint: "http://127.0.0.1:1/user-mcp",
      });

      const userView = yield* executor.mcp.getSource("shared", USER_SCOPE as string);
      const orgView = yield* executor.mcp.getSource("shared", ORG_SCOPE as string);

      // Both rows must coexist — the store's scope-pinned getters
      // return the exact row regardless of the scope stack's
      // fall-through order.
      expect(userView?.name).toBe("User Source");
      expect(userView?.scope).toBe(USER_SCOPE as string);
      expect(orgView?.name).toBe("Org Source");
      expect(orgView?.scope).toBe(ORG_SCOPE as string);
    }),
  );

  it.effect("removeSource on user shadow leaves the org row intact", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          scopes: stackedScopes,
          plugins: [mcpPlugin()] as const,
        }),
      );

      yield* seedShadowed(executor.mcp.addSource, {
        scope: ORG_SCOPE as string,
        name: "Org Source",
        endpoint: "http://127.0.0.1:1/org-mcp",
      });
      yield* seedShadowed(executor.mcp.addSource, {
        scope: USER_SCOPE as string,
        name: "User Source",
        endpoint: "http://127.0.0.1:1/user-mcp",
      });

      yield* executor.mcp.removeSource("shared", USER_SCOPE as string);

      const userView = yield* executor.mcp.getSource("shared", USER_SCOPE as string);
      const orgView = yield* executor.mcp.getSource("shared", ORG_SCOPE as string);

      expect(userView).toBeNull();
      expect(orgView?.name).toBe("Org Source");
    }),
  );

  it.effect("updateSource on user shadow does not mutate the org row", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          scopes: stackedScopes,
          plugins: [mcpPlugin()] as const,
        }),
      );

      yield* seedShadowed(executor.mcp.addSource, {
        scope: ORG_SCOPE as string,
        name: "Org Source",
        endpoint: "http://127.0.0.1:1/org-mcp",
      });
      yield* seedShadowed(executor.mcp.addSource, {
        scope: USER_SCOPE as string,
        name: "User Source",
        endpoint: "http://127.0.0.1:1/user-mcp",
      });

      yield* executor.mcp.updateSource("shared", USER_SCOPE as string, {
        name: "User Renamed",
        endpoint: "http://127.0.0.1:1/user-new-mcp",
      });

      const userView = yield* executor.mcp.getSource("shared", USER_SCOPE as string);
      const orgView = yield* executor.mcp.getSource("shared", ORG_SCOPE as string);

      expect(userView?.name).toBe("User Renamed");
      expect(userView?.config.transport).toBe("remote");
      if (userView?.config.transport === "remote") {
        expect(userView.config.endpoint).toBe("http://127.0.0.1:1/user-new-mcp");
      }
      expect(orgView?.name).toBe("Org Source");
      expect(orgView?.config.transport).toBe("remote");
      if (orgView?.config.transport === "remote") {
        expect(orgView.config.endpoint).toBe("http://127.0.0.1:1/org-mcp");
      }
    }),
  );

  // -------------------------------------------------------------------------
  // Annotation policy override — per-source `requireApprovalForAll` toggle.
  //
  // MCP tools default to `requiresApproval: false` because the server
  // handles approval mid-invocation via elicitation. When an admin flips
  // `{ requireApprovalForAll: true }` on the source, every tool from
  // that source picks up a pre-call approval gate instead.
  //
  // We spin up a real in-process MCP server so `executor.tools.list()`
  // returns actual tool rows — that's what `resolveAnnotations` is keyed
  // on. The server is intentionally minimal: two tools, no elicitation,
  // no auth.
  // -------------------------------------------------------------------------

  type AnnotationTestServer = {
    readonly url: string;
    readonly httpServer: http.Server;
  };

  const makeAnnotationTestServer = (): Effect.Effect<
    AnnotationTestServer,
    Error,
    never
  > =>
    Effect.async<AnnotationTestServer, Error>((resume) => {
      const transports = new Map<string, StreamableHTTPServerTransport>();

      const buildServer = () => {
        const server = new McpServer(
          { name: "annotation-test-server", version: "1.0.0" },
          { capabilities: {} },
        );
        server.registerTool(
          "echo_a",
          { description: "echo a", inputSchema: { value: z.string() } },
          async ({ value }: { value: string }) => ({
            content: [{ type: "text" as const, text: value }],
          }),
        );
        server.registerTool(
          "echo_b",
          { description: "echo b", inputSchema: { value: z.string() } },
          async ({ value }: { value: string }) => ({
            content: [{ type: "text" as const, text: value }],
          }),
        );
        return server;
      };

      const httpServer = http.createServer(async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (sessionId) {
          const transport = transports.get(sessionId);
          if (!transport) {
            res.writeHead(404);
            res.end("Session not found");
            return;
          }
          await transport.handleRequest(req, res);
          return;
        }
        const mcpServer = buildServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
          },
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      });

      httpServer.listen(0, () => {
        const addr = httpServer.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resume(
          Effect.succeed({
            url: `http://127.0.0.1:${port}`,
            httpServer,
          }),
        );
      });
    });

  const withAnnotationServer = Effect.acquireRelease(
    makeAnnotationTestServer(),
    ({ httpServer }) =>
      Effect.sync(() => {
        httpServer.close();
      }),
  );

  it.scoped("default — no annotationPolicy leaves tools auto-approved", () =>
    Effect.gen(function* () {
      const server = yield* withAnnotationServer;
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [mcpPlugin()] as const }),
      );

      yield* executor.mcp.addSource({
        transport: "remote",
        scope: "test-scope",
        name: "annot-default",
        endpoint: server.url,
        namespace: "annot_default",
      });

      const tools = yield* executor.tools.list();
      const fromSource = tools.filter((t) => t.sourceId === "annot_default");
      expect(fromSource.length).toBeGreaterThanOrEqual(2);
      for (const t of fromSource) {
        expect(t.annotations?.requiresApproval ?? false).toBe(false);
      }

      const stored = yield* executor.mcp.getSource("annot_default", "test-scope");
      expect(stored?.annotationPolicy).toBeUndefined();
    }),
  );

  it.scoped(
    "override on — requireApprovalForAll:true forces approval on every tool",
    () =>
      Effect.gen(function* () {
        const server = yield* withAnnotationServer;
        const executor = yield* createExecutor(
          makeTestConfig({ plugins: [mcpPlugin()] as const }),
        );

        yield* executor.mcp.addSource({
          transport: "remote",
          scope: "test-scope",
          name: "annot-on",
          endpoint: server.url,
          namespace: "annot_on",
          annotationPolicy: { requireApprovalForAll: true },
        });

        const tools = yield* executor.tools.list();
        const fromSource = tools.filter((t) => t.sourceId === "annot_on");
        expect(fromSource.length).toBeGreaterThanOrEqual(2);
        for (const t of fromSource) {
          expect(t.annotations?.requiresApproval).toBe(true);
          expect(t.annotations?.approvalDescription).toBeTypeOf("string");
          expect(t.annotations?.approvalDescription?.length ?? 0).toBeGreaterThan(
            0,
          );
        }

        const stored = yield* executor.mcp.getSource("annot_on", "test-scope");
        expect(stored?.annotationPolicy?.requireApprovalForAll).toBe(true);
      }),
  );

  it.scoped(
    "override off (explicit false) — same approval shape as default but persists",
    () =>
      Effect.gen(function* () {
        const server = yield* withAnnotationServer;
        const executor = yield* createExecutor(
          makeTestConfig({ plugins: [mcpPlugin()] as const }),
        );

        yield* executor.mcp.addSource({
          transport: "remote",
          scope: "test-scope",
          name: "annot-off",
          endpoint: server.url,
          namespace: "annot_off",
          annotationPolicy: { requireApprovalForAll: false },
        });

        const tools = yield* executor.tools.list();
        const fromSource = tools.filter((t) => t.sourceId === "annot_off");
        expect(fromSource.length).toBeGreaterThanOrEqual(2);
        for (const t of fromSource) {
          expect(t.annotations?.requiresApproval ?? false).toBe(false);
        }

        // Round-trip distinguishes an explicit-off from absent.
        const stored = yield* executor.mcp.getSource("annot_off", "test-scope");
        expect(stored?.annotationPolicy).toBeDefined();
        expect(stored?.annotationPolicy?.requireApprovalForAll).toBe(false);
      }),
  );

  it.scoped(
    "updateSource(annotationPolicy: null) clears the override",
    () =>
      Effect.gen(function* () {
        const server = yield* withAnnotationServer;
        const executor = yield* createExecutor(
          makeTestConfig({ plugins: [mcpPlugin()] as const }),
        );

        yield* executor.mcp.addSource({
          transport: "remote",
          scope: "test-scope",
          name: "annot-clear",
          endpoint: server.url,
          namespace: "annot_clear",
          annotationPolicy: { requireApprovalForAll: true },
        });

        // Sanity — before the clear, every tool requires approval.
        let tools = yield* executor.tools.list();
        let fromSource = tools.filter((t) => t.sourceId === "annot_clear");
        for (const t of fromSource) {
          expect(t.annotations?.requiresApproval).toBe(true);
        }

        yield* executor.mcp.updateSource("annot_clear", "test-scope", {
          annotationPolicy: null,
        });

        tools = yield* executor.tools.list();
        fromSource = tools.filter((t) => t.sourceId === "annot_clear");
        for (const t of fromSource) {
          expect(t.annotations?.requiresApproval ?? false).toBe(false);
        }

        const stored = yield* executor.mcp.getSource("annot_clear", "test-scope");
        expect(stored?.annotationPolicy).toBeUndefined();
      }),
  );

  it.scoped(
    "updateSource without annotationPolicy key leaves the override alone",
    () =>
      Effect.gen(function* () {
        const server = yield* withAnnotationServer;
        const executor = yield* createExecutor(
          makeTestConfig({ plugins: [mcpPlugin()] as const }),
        );

        yield* executor.mcp.addSource({
          transport: "remote",
          scope: "test-scope",
          name: "annot-keep",
          endpoint: server.url,
          namespace: "annot_keep",
          annotationPolicy: { requireApprovalForAll: true },
        });

        // Update a sibling field only — policy must survive unchanged.
        yield* executor.mcp.updateSource("annot_keep", "test-scope", {
          name: "annot-keep-renamed",
        });

        const stored = yield* executor.mcp.getSource("annot_keep", "test-scope");
        expect(stored?.name).toBe("annot-keep-renamed");
        expect(stored?.annotationPolicy?.requireApprovalForAll).toBe(true);

        const tools = yield* executor.tools.list();
        const fromSource = tools.filter((t) => t.sourceId === "annot_keep");
        expect(fromSource.length).toBeGreaterThanOrEqual(2);
        for (const t of fromSource) {
          expect(t.annotations?.requiresApproval).toBe(true);
        }
      }),
  );
});
