import { createPluginAtomClient } from "@executor-js/sdk/client";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { ContextAwareHttpClient } from "@executor-js/react/api/http-client";
import { OpenApiGroup } from "../api/group";

export const OpenApiClient = createPluginAtomClient(OpenApiGroup, {
  baseUrl: getBaseUrl(),
  httpClient: ContextAwareHttpClient,
});
