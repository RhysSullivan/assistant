import { lazy } from "react";
import type { SourcePlugin } from "@executor/react";
import { mcpPresets } from "../sdk/presets";

export const mcpSourcePlugin: SourcePlugin = {
  key: "mcp",
  label: "MCP",
  add: lazy(() => import("./AddMcpSource")),
  edit: lazy(() => import("./EditMcpSource")),
  summary: lazy(() => import("./McpSourceSummary")),
  presets: mcpPresets,
};
