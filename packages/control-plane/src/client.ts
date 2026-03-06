import {
  FetchHttpClient,
  HttpApiClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import * as Effect from "effect/Effect";

import { ControlPlaneApi } from "./api";
import { ControlPlaneAuthHeaders } from "./runtime";

export const createControlPlaneClient = (input: {
  baseUrl: string;
  accountId?: string;
}) => {
  const accountId = input.accountId;

  return HttpApiClient.make(ControlPlaneApi, {
    baseUrl: input.baseUrl,
    transformClient: accountId
      ? (client) =>
          client.pipe(
            HttpClient.mapRequest(
              HttpClientRequest.setHeader(
                ControlPlaneAuthHeaders.accountId,
                accountId,
              ),
            ),
          )
      : undefined,
  }).pipe(Effect.provide(FetchHttpClient.layer));
};

export type ControlPlaneClient = Effect.Effect.Success<
  ReturnType<typeof createControlPlaneClient>
>;
