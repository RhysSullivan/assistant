import { Data, Effect } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  createExecutorMcpServer,
  type ExecutorMcpServerConfig,
} from "@executor-js/host-mcp";

// ---------------------------------------------------------------------------
// Streamable HTTP handler
// ---------------------------------------------------------------------------

export type McpRequestHandler = {
  readonly handleRequest: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
};

const jsonError = (status: number, code: number, message: string): Response =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );

class McpBoundaryError extends Data.TaggedError("McpBoundaryError")<{
  readonly cause: unknown;
}> {}

const tryBoundaryPromise = <A>(try_: () => Promise<A>) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new McpBoundaryError({ cause }),
  });

const ignoreBoundaryPromise = (try_: () => Promise<unknown>) =>
  Effect.ignore(tryBoundaryPromise(try_));

export const createMcpRequestHandler = (
  config: ExecutorMcpServerConfig
): McpRequestHandler => {
  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  const servers = new Map<string, McpServer>();

  const dispose = async (
    id: string,
    opts: { transport?: boolean; server?: boolean } = {}
  ) => {
    const t = transports.get(id);
    const s = servers.get(id);
    transports.delete(id);
    servers.delete(id);
    await Effect.runPromise(
      Effect.all(
        [
          opts.transport && t
            ? ignoreBoundaryPromise(() => t.close())
            : Effect.void,
          opts.server && s
            ? ignoreBoundaryPromise(() => s.close())
            : Effect.void,
        ],
        { discard: true }
      )
    );
  };

  const cleanupUninitialized = (
    transport: WebStandardStreamableHTTPServerTransport,
    server?: McpServer
  ) =>
    transport.sessionId
      ? Effect.void
      : Effect.all(
          [
            ignoreBoundaryPromise(() => transport.close()),
            server ? ignoreBoundaryPromise(() => server.close()) : Effect.void,
          ],
          { discard: true }
        );

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

      return Effect.runPromise(
        Effect.gen(function* () {
          const server = yield* createExecutorMcpServer(config);
          created = server;
          yield* tryBoundaryPromise(() => server.connect(transport));
          const response = yield* tryBoundaryPromise(() =>
            transport.handleRequest(request)
          );
          yield* cleanupUninitialized(transport, server);
          return response;
        }).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              console.error("[mcp] handleRequest error:", cause);
              yield* cleanupUninitialized(transport, created);
              return jsonError(500, -32603, "Internal server error");
            })
          )
        )
      );
    },

    close: async () => {
      const ids = new Set([...transports.keys(), ...servers.keys()]);
      await Promise.all(
        [...ids].map((id) => dispose(id, { transport: true, server: true }))
      );
    },
  };
};

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

export const runMcpStdioServer = async (
  config: ExecutorMcpServerConfig
): Promise<void> => {
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

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* tryBoundaryPromise(() => server.connect(transport));
      yield* tryBoundaryPromise(waitForExit);
    }).pipe(
      Effect.ensuring(
        Effect.all(
          [
            ignoreBoundaryPromise(() => transport.close()),
            ignoreBoundaryPromise(() => server.close()),
          ],
          {
            discard: true,
          }
        )
      )
    )
  );
};
