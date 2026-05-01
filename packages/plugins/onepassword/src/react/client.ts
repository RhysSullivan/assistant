import { Atom, AtomHttpApi, Result } from "@effect-atom/atom-react";
import { FetchHttpClient } from "effect/unstable/http";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { OnePasswordGroup } from "../api/group";

type AtomHttpApiClientBoundary = {
  readonly query: (...args: ReadonlyArray<any>) => Atom.Atom<Result.Result<any, any>>;
  readonly mutation: (...args: ReadonlyArray<any>) => Atom.AtomResultFn<any, any, any>;
};

// ---------------------------------------------------------------------------
// 1Password-aware client — core routes + onepassword routes
// ---------------------------------------------------------------------------

const OnePasswordApi = addGroup(OnePasswordGroup);
const LegacyAtomHttpApi = AtomHttpApi as any;

export const OnePasswordClient = LegacyAtomHttpApi.Tag()("OnePasswordClient", {
  api: OnePasswordApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
}) as AtomHttpApiClientBoundary;
