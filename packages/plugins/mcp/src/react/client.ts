import { createPluginAtomClient } from "@executor-js/sdk/client";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { ContextAwareHttpClient } from "@executor-js/react/api/http-client";
import { McpGroup } from "../api/group";

export const McpClient = createPluginAtomClient(McpGroup, {
  baseUrl: getBaseUrl(),
  httpClient: ContextAwareHttpClient,
});
