import { Atom, AtomHttpApi, Result } from "@effect-atom/atom-react";
import { FetchHttpClient } from "effect/unstable/http";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { CloudAuthApi } from "../auth/api";
import { OrgApi } from "../org/api";

// ---------------------------------------------------------------------------
// Cloud API client — core API + cloud auth + org
// ---------------------------------------------------------------------------

const CloudApi = addGroup(CloudAuthApi).add(OrgApi);
const LegacyAtomHttpApi = AtomHttpApi as any;

type AtomHttpApiClientBoundary = {
  readonly query: (...args: ReadonlyArray<any>) => Atom.Atom<Result.Result<any, any>>;
  readonly mutation: (...args: ReadonlyArray<any>) => Atom.AtomResultFn<any, any, any>;
};

const CloudApiClient = LegacyAtomHttpApi.Tag()("CloudApiClient", {
  api: CloudApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
}) as AtomHttpApiClientBoundary;

export { CloudApiClient };
