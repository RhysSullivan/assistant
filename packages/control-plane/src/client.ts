import {
  FetchHttpClient,
  HttpApiClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import * as Effect from "effect/Effect";

import { ControlPlaneApi } from "./api/api";
import { ControlPlaneAuthHeaders } from "./auth-headers";

export const createControlPlaneClient = (input: {
  baseUrl: string;
  accountId?: string;
  apiKey?: string;
}) => {
  const headers = {
    ...(input.accountId
      ? {
          [ControlPlaneAuthHeaders.accountId]: input.accountId,
        }
      : {}),
    ...(input.apiKey
      ? {
          authorization: `Bearer ${input.apiKey}`,
        }
      : {}),
  };

  return HttpApiClient.make(ControlPlaneApi, {
    baseUrl: input.baseUrl,
    transformClient: Object.keys(headers).length > 0
      ? (client) =>
          client.pipe(
            HttpClient.mapRequest((request) =>
              HttpClientRequest.setHeaders(request, headers)
            ),
          )
      : undefined,
  }).pipe(Effect.provide(FetchHttpClient.layer));
};

export type ControlPlaneClient = Effect.Effect.Success<
  ReturnType<typeof createControlPlaneClient>
>;
