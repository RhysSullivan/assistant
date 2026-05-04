import * as AtomHttpApi from "effect/unstable/reactivity/AtomHttpApi";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { ContextAwareHttpClient } from "@executor-js/react/api/http-client";
import { CloudAuthApi } from "../auth/api";
import { OrgApi } from "../org/api";
import { WorkspacesApi } from "../workspaces/api";

// ---------------------------------------------------------------------------
// Cloud API client — core API + cloud auth + org + workspaces
// ---------------------------------------------------------------------------
//
// Uses the same URL-context-aware fetch wrapper as the executor client so
// org-prefixed routes (`/api/:org/...`) are addressed correctly while
// auth/sentry/autumn routes stay unprefixed.

const CloudApi = addGroup(CloudAuthApi).add(OrgApi).add(WorkspacesApi);
const CloudApiClient = AtomHttpApi.Service<"CloudApiClient">()("CloudApiClient", {
  api: CloudApi,
  httpClient: ContextAwareHttpClient,
  baseUrl: getBaseUrl(),
});

export { CloudApiClient };
