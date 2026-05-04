import * as AtomHttpApi from "effect/unstable/reactivity/AtomHttpApi";
import { ExecutorApi } from "@executor-js/api";

import { getBaseUrl } from "./base-url";
import { ContextAwareHttpClient } from "./http-client";

// ---------------------------------------------------------------------------
// Core executor API client — URL-context aware via `ContextAwareHttpClient`
// ---------------------------------------------------------------------------

const ExecutorApiClient = AtomHttpApi.Service<"ExecutorApiClient">()("ExecutorApiClient", {
  api: ExecutorApi,
  httpClient: ContextAwareHttpClient,
  baseUrl: getBaseUrl(),
});

export { ExecutorApiClient };
