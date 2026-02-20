import { test, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createAgent } from "./agent";

/**
 * Mock MCP server that exposes execute.
 * Actually executes nothing — just returns a canned stdout.
 */
function createMockMcpServer() {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const mcp = new McpServer(
        { name: "mock-executor", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );

      mcp.registerTool(
        "execute",
        {
          description:
            'Execute TypeScript code in a sandbox.\n\nAvailable tools in the sandbox:\n  - tools.utils.get_time({}): { iso: string; unix: number } — Get the current server time',
          inputSchema: { code: z.string() },
        },
        async () => ({
          content: [
            {
              type: "text" as const,
              text: 'taskId: task_123\nstatus: completed\nexitCode: 0\n\n```text\n{"iso":"2026-02-07T12:00:00.000Z","unix":1770465600000}\n```',
            },
          ],
        }),
      );

      try {
        await mcp.connect(transport);
        return await transport.handleRequest(request);
      } finally {
        await transport.close().catch(() => {});
        await mcp.close().catch(() => {});
      }
    },
  });
}

test("agent calls Claude, runs code via MCP, returns result", async () => {
  const server = createMockMcpServer();
  const events: string[] = [];

  const agent = createAgent({
    executorUrl: `http://127.0.0.1:${server.port}`,
    workspaceId: "ws_test",
    accountId: "account_test",
  });

  const result = await agent.run("What is the current server time?", (event) => {
    events.push(event.type);
    const text = (event as { text?: unknown }).text;
    console.log(`  [event] ${event.type}`, typeof text === "string" ? text.slice(0, 80) : "");
  });

  expect(result.text.length).toBeGreaterThan(0);
  expect(result.toolCalls).toBeGreaterThanOrEqual(1);
  expect(events).toContain("status");
  expect(events).toContain("code_generated");
  expect(events).toContain("code_result");
  expect(events).toContain("agent_message");
  expect(events).toContain("completed");

  server.stop(true);
}, 30_000);

test("agent responds without tool calls for simple questions", async () => {
  const server = createMockMcpServer();

  const agent = createAgent({
    executorUrl: `http://127.0.0.1:${server.port}`,
    workspaceId: "ws_test",
    accountId: "account_test",
  });

  const result = await agent.run("Say hello. Do not run any code.");

  expect(result.text.length).toBeGreaterThan(0);
  expect(result.toolCalls).toBe(0);

  server.stop(true);
}, 30_000);
