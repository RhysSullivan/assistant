import { AtomHttpApi } from "@effect-atom/atom";
import {
  FetchHttpClient,
  HttpApiClient,
  HttpApiError,
  HttpClientError,
} from "@effect/platform";
import * as ParseResult from "effect/ParseResult";

import {
  ControlPlaneApi,
  type ControlPlaneBadRequestError,
  type ControlPlaneStorageError,
} from "./api";

export type ControlPlaneClientOptions = {
  baseUrl: string;
};

export type ControlPlaneClientError =
  | ControlPlaneBadRequestError
  | ControlPlaneStorageError
  | HttpApiError.HttpApiDecodeError
  | HttpClientError.HttpClientError
  | ParseResult.ParseError;

export const makeControlPlaneClient = (options: ControlPlaneClientOptions) =>
  HttpApiClient.make(ControlPlaneApi, {
    baseUrl: options.baseUrl,
  });

export const createControlPlaneAtomClient = (options: ControlPlaneClientOptions) =>
  AtomHttpApi.Tag<unknown>()("@executor-v2/control-plane/AtomClient", {
    api: ControlPlaneApi,
    httpClient: FetchHttpClient.layer,
    baseUrl: options.baseUrl,
  });

export type ControlPlaneAtomClient = ReturnType<typeof createControlPlaneAtomClient>;
