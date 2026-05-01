import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "effect/unstable/http";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { GraphqlGroup } from "../api/group";

// ---------------------------------------------------------------------------
// GraphQL-aware client — core routes + graphql routes
// ---------------------------------------------------------------------------

const GraphqlApi = addGroup(GraphqlGroup);
const AtomHttpApiCompat = AtomHttpApi as any;

export const GraphqlClient = AtomHttpApiCompat.Tag()("GraphqlClient", {
  api: GraphqlApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
});
