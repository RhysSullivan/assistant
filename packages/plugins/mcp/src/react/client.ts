import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "effect/unstable/http";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { McpGroup } from "../api/group";

// ---------------------------------------------------------------------------
// MCP-aware client — core routes + mcp routes
// ---------------------------------------------------------------------------

const McpApi = addGroup(McpGroup);

export const McpClient = AtomHttpApi.Tag<"McpClient">()("McpClient", {
  api: McpApi as never,
  httpClient: FetchHttpClient.layer as never,
  baseUrl: getBaseUrl(),
}) as any;
