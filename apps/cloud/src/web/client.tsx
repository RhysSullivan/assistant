import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "@effect/platform";
import { addGroup } from "@executor/api";
import { getBaseUrl } from "@executor/react/api/base-url";
import { CloudAuthApi } from "../auth/api";
import { TeamApi } from "../team/api";

// ---------------------------------------------------------------------------
// Cloud API client — core API + cloud auth + team
// ---------------------------------------------------------------------------

const CloudApi = addGroup(CloudAuthApi).add(TeamApi);

class CloudApiClient extends AtomHttpApi.Tag<CloudApiClient>()("CloudApiClient", {
  api: CloudApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
}) {}

export { CloudApiClient };
