import {
  HttpApiBuilder,
  HttpApiClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ControlPlaneActorResolver,
  ControlPlaneApi,
  ControlPlaneApiLive,
  ControlPlaneService,
} from "#api";

import {
  ControlPlaneAuthHeaders,
  type SqlControlPlaneRuntime,
} from "./index";

const makeClientLayer = (runtime: SqlControlPlaneRuntime) => {
  const serviceLayer = Layer.succeed(ControlPlaneService, runtime.service);
  const actorResolverLayer = Layer.succeed(
    ControlPlaneActorResolver,
    runtime.actorResolver,
  );
  const apiLayer = ControlPlaneApiLive.pipe(
    Layer.provide(serviceLayer),
    Layer.provide(actorResolverLayer),
  );

  return HttpApiBuilder.serve().pipe(
    Layer.provide(apiLayer),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
};

export const withControlPlaneClient = <A, E>(
  input: {
    runtime: SqlControlPlaneRuntime;
    accountId?: string;
  },
  f: (client: any) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E | unknown, never> =>
  Effect.gen(function* () {
    const accountId = input.accountId;
    const client = yield* HttpApiClient.make(ControlPlaneApi, {
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
    });

    return yield* f(client);
  }).pipe(Effect.provide(makeClientLayer(input.runtime)));
