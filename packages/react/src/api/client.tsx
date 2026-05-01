import { Atom, AtomHttpApi, Result } from "@effect-atom/atom-react";
import { FetchHttpClient } from "effect/unstable/http";
import { ExecutorApi } from "@executor-js/api";

import { getBaseUrl } from "./base-url";

// ---------------------------------------------------------------------------
// Core API client — tools + secrets
// ---------------------------------------------------------------------------

type AtomHttpApiClientBoundary = {
  readonly query: (...args: ReadonlyArray<any>) => Atom.Atom<Result.Result<any, any>>;
  readonly mutation: (...args: ReadonlyArray<any>) => Atom.AtomResultFn<any, any, any>;
};

const LegacyAtomHttpApi = AtomHttpApi as any;

const ExecutorApiClient = LegacyAtomHttpApi.Tag()("ExecutorApiClient", {
  api: ExecutorApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
}) as AtomHttpApiClientBoundary;

export { ExecutorApiClient };
