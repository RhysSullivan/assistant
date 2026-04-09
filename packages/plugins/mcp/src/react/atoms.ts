import { McpClient } from "./client";

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const probeMcpEndpoint = McpClient.mutation("mcp", "probeEndpoint");
export const addMcpSource = McpClient.mutation("mcp", "addSource");
export const removeMcpSource = McpClient.mutation("mcp", "removeSource");
export const refreshMcpSource = McpClient.mutation("mcp", "refreshSource");
export const startMcpOAuth = McpClient.mutation("mcp", "startOAuth");
export const completeMcpOAuth = McpClient.mutation("mcp", "completeOAuth");
export const updateMcpSource = McpClient.mutation("mcp", "updateSource");
