import { createPluginAtomClient } from "@executor-js/sdk/client";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { ContextAwareHttpClient } from "@executor-js/react/api/http-client";
import { GoogleDiscoveryGroup } from "../api/group";

export const GoogleDiscoveryClient = createPluginAtomClient(
  GoogleDiscoveryGroup,
  {
    baseUrl: getBaseUrl(),
    httpClient: ContextAwareHttpClient,
  },
);
