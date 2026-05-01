import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "@effect/platform";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { OnePasswordGroup } from "../api/group";

// ---------------------------------------------------------------------------
// 1Password-aware client — core routes + onepassword routes
// ---------------------------------------------------------------------------

const OnePasswordApi = addGroup(OnePasswordGroup);

export const OnePasswordClient = AtomHttpApi.Tag<"OnePasswordClient">()("OnePasswordClient", {
  api: OnePasswordApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
});
