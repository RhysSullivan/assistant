import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "effect/unstable/http";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { OpenApiGroup } from "../api/group";

// ---------------------------------------------------------------------------
// OpenAPI-aware client — core routes + openapi routes
// ---------------------------------------------------------------------------

const OpenApiApi = addGroup(OpenApiGroup);

export const OpenApiClient = AtomHttpApi.Tag<"OpenApiClient">()("OpenApiClient", {
  api: OpenApiApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
} as any) as any;
