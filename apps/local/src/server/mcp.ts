import { Cause, Effect, Exit } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createExecutorMcpServer, type ExecutorMcpServerConfig } from "@executor-js/host-mcp";

// ---------------------------------------------------------------------------
// Streamable HTTP handler
// ---------------------------------------------------------------------------

export type McpRequestHandler = {
  readonly handleRequest: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
};

const jsonError = (status: number, code: number, message: string): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json" },
  });

const closeIgnoringFailure = (close: (() => Promise<void>) | undefined): Promise<void> =>
  close
    ? Effect.runPromise(
        Effect.ignore(
          Effect.tryPromise({
            try: close,
            catch: (cause) => cause,
          }),
        ),
      )
    : Promise.resolve();

export const createMcpRequestHandler = (config: ExecutorMcpServerConfig): McpRequestHandler => {
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const servers = new Map<string, McpServer>();

  const dispose = async (id: string, opts: { transport?: boolean; server?: boolean } = {}) => {
    const t = transports.get(id);
    const s = servers.get(id);
    transports.delete(id);
    servers.delete(id);
    if (opts.transport) await closeIgnoringFailure(t?.close.bind(t));
    if (opts.server) await closeIgnoringFailure(s?.close.bind(s));
  };

  return {
    handleRequest: async (request) => {
      const sessionId = request.headers.get("mcp-session-id");

      if (sessionId) {
        const transport = transports.get(sessionId);
        if (!transport) return jsonError(404, -32001, "Session not found");
        return transport.handleRequest(request);
      }

      let created: McpServer | undefined;
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
          if (created) servers.set(sid, created);
        },
        onsessionclosed: (sid) => void dispose(sid, { server: true }),
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) void dispose(sid, { server: true });
      };

      const responseExit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          created = yield* createExecutorMcpServer(config);
          yield* Effect.tryPromise({
            try: () => created!.connect(transport),
            catch: (cause) => cause,
          });
          return yield* Effect.tryPromise({
            try: () => transport.handleRequest(request),
            catch: (cause) => cause,
          });
        }),
      );

      if (Exit.isSuccess(responseExit)) {
        if (!transport.sessionId) {
          await closeIgnoringFailure(transport.close.bind(transport));
          await closeIgnoringFailure(created?.close.bind(created));
        }
        return responseExit.value;
      }

      console.error("[mcp] handleRequest error:", Cause.pretty(responseExit.cause));
      if (!transport.sessionId) {
        await closeIgnoringFailure(transport.close.bind(transport));
        await closeIgnoringFailure(created?.close.bind(created));
      }
      return jsonError(500, -32603, "Internal server error");
    },

    close: async () => {
      const ids = new Set([...transports.keys(), ...servers.keys()]);
      await Promise.all([...ids].map((id) => dispose(id, { transport: true, server: true })));
    },
  };
};

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

export const runMcpStdioServer = async (config: ExecutorMcpServerConfig): Promise<void> => {
  const server = await Effect.runPromise(createExecutorMcpServer(config));
  const transport = new StdioServerTransport();

  const waitForExit = () =>
    new Promise<void>((resolve) => {
      const finish = () => {
        process.off("SIGINT", finish);
        process.off("SIGTERM", finish);
        process.stdin.off("end", finish);
        process.stdin.off("close", finish);
        resolve();
      };
      process.once("SIGINT", finish);
      process.once("SIGTERM", finish);
      process.stdin.once("end", finish);
      process.stdin.once("close", finish);
    });

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => server.connect(transport),
        catch: (cause) => cause,
      });
      yield* Effect.tryPromise({
        try: waitForExit,
        catch: (cause) => cause,
      });
    }),
  );

  await closeIgnoringFailure(transport.close.bind(transport));
  await closeIgnoringFailure(server.close.bind(server));

  if (Exit.isFailure(exit)) {
    await Effect.runPromise(Effect.failCause(exit.cause));
  }
};
