import { createPluginAtomClient } from "@executor-js/sdk/client";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { ContextAwareHttpClient } from "@executor-js/react/api/http-client";
import { GraphqlGroup } from "../api/group";

export const GraphqlClient = createPluginAtomClient(GraphqlGroup, {
  baseUrl: getBaseUrl(),
  httpClient: ContextAwareHttpClient,
});
