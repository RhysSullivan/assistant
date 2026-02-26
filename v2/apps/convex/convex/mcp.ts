import { handleMcpHttpRequest } from "@executor-v2/mcp-gateway";
import { createExecutorRunClient } from "@executor-v2/sdk";
import { httpAction } from "./_generated/server";
const runClient = createExecutorRunClient(async () => ({
  runId: `run_${Date.now()}`,
  status: "failed" as const,
  error: "Convex run client is not wired yet",
}));
export const mcpHandler = httpAction(async (_ctx, request) =>
  handleMcpHttpRequest(request, {
    target: "remote",
    serverName: "executor-v2-convex",
    serverVersion: "0.0.0",
    runClient,
  }));
