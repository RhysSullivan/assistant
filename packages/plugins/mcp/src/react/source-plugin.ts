import { lazy } from "react";
import type { SourcePlugin } from "@executor/react";

// ---------------------------------------------------------------------------
// MCP source plugin — lazy-loaded components
// ---------------------------------------------------------------------------

export const mcpSourcePlugin: SourcePlugin = {
  key: "mcp",
  label: "MCP",
  add: lazy(() => import("./AddMcpSource")),
  edit: lazy(() => import("./EditMcpSource")),
  summary: lazy(() => import("./McpSourceSummary")),
};
