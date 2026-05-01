import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "@effect/platform";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { GoogleDiscoveryGroup } from "../api/group";

const GoogleDiscoveryApi = addGroup(GoogleDiscoveryGroup);

export const GoogleDiscoveryClient = AtomHttpApi.Tag<"GoogleDiscoveryClient">()(
  "GoogleDiscoveryClient",
  {
    api: GoogleDiscoveryApi,
    httpClient: FetchHttpClient.layer,
    baseUrl: getBaseUrl(),
  },
);
