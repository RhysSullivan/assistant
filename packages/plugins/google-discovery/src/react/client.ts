import { Atom, AtomHttpApi, Result } from "@effect-atom/atom-react";
import { FetchHttpClient } from "effect/unstable/http";
import { addGroup } from "@executor-js/api";
import { getBaseUrl } from "@executor-js/react/api/base-url";
import { GoogleDiscoveryGroup } from "../api/group";

const GoogleDiscoveryApi = addGroup(GoogleDiscoveryGroup);
const LegacyAtomHttpApi = AtomHttpApi as any;

type AtomHttpApiClientBoundary = {
  readonly query: (...args: ReadonlyArray<any>) => Atom.Atom<Result.Result<any, any>>;
  readonly mutation: (...args: ReadonlyArray<any>) => Atom.AtomResultFn<any, any, any>;
};

export const GoogleDiscoveryClient = LegacyAtomHttpApi.Tag()("GoogleDiscoveryClient", {
  api: GoogleDiscoveryApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: getBaseUrl(),
}) as AtomHttpApiClientBoundary;
