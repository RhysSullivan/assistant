import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

type Runtime = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
};

const runtimes = new Map<string, Runtime>();
const DEFAULT_APPROVAL_MESSAGE = "Approve this operation?";

function createRuntime(): Runtime {
  const server = new McpServer(
    { name: "vscode-elicitation-demo", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "request_approval",
    {
      description: "Prompts the MCP client for approval using form elicitation.",
      inputSchema: {},
    },
    async (input) => {
      const message =
        typeof (input as { message?: unknown }).message === "string"
          ? (input as { message: string }).message
          : DEFAULT_APPROVAL_MESSAGE;

      const capabilities = server.server.getClientCapabilities?.();
      console.log("[elicitation-demo] client capabilities:", JSON.stringify(capabilities ?? {}));

      const result = await server.server.elicitInput({
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              title: "Decision",
              oneOf: [
                { const: "approved", title: "Approve" },
                { const: "denied", title: "Deny" },
              ],
              default: "approved",
            },
            reason: {
              type: "string",
              title: "Reason",
              maxLength: 200,
            },
          },
          required: ["decision"],
        },
      }, { timeout: 120_000 });

      const action = result.action;
      if (action !== "accept") {
        return {
          content: [{ type: "text", text: `Elicitation ${action}` }],
          structuredContent: { action },
        };
      }

      const decision = result.content?.decision === "approved" ? "approved" : "denied";
      const reason = typeof result.content?.reason === "string" ? result.content.reason : undefined;

      return {
        content: [{ type: "text", text: `Decision: ${decision}${reason ? ` (${reason})` : ""}` }],
        structuredContent: {
          action,
          decision,
          reason,
        },
      };
    },
  );

  server.registerTool(
    "ping",
    {
      description: "Simple health tool.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "pong" }],
    }),
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      runtimes.set(sessionId, { server, transport });
      console.log(`[elicitation-demo] session initialized: ${sessionId}`);
    },
    onsessionclosed: async (sessionId) => {
      if (!sessionId) return;
      const runtime = runtimes.get(sessionId);
      if (!runtime) return;
      runtimes.delete(sessionId);
      await runtime.server.close().catch(() => {});
      console.log(`[elicitation-demo] session closed: ${sessionId}`);
    },
  });

  return { server, transport };
}

async function handleMcp(request: Request): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id") ?? undefined;

  if (sessionId) {
    const existing = runtimes.get(sessionId);
    if (existing) {
      return await existing.transport.handleRequest(request);
    }

    // Graceful recovery: ignore stale session header and start a new runtime.
    const headers = new Headers(request.headers);
    headers.delete("mcp-session-id");
    request = new Request(request, { headers });
  }

  const runtime = createRuntime();

  try {
    await runtime.server.connect(runtime.transport);
    const response = await runtime.transport.handleRequest(request);
    const initializedSessionId = response.headers.get("mcp-session-id");
    if (!initializedSessionId) {
      await runtime.transport.close().catch(() => {});
      await runtime.server.close().catch(() => {});
    }
    return response;
  } catch (error) {
    await runtime.transport.close().catch(() => {});
    await runtime.server.close().catch(() => {});
    throw error;
  }
}

const port = Number(Bun.env.PORT ?? 8787);

Bun.serve({
  port,
  routes: {
    "/": new Response("ok"),
    "/health": new Response("ok"),
    "/mcp": {
      POST: async (req) => await handleMcp(req),
      GET: async (req) => await handleMcp(req),
      DELETE: async (req) => await handleMcp(req),
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`[elicitation-demo] listening on http://localhost:${port}/mcp`);
