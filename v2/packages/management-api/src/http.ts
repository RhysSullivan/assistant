import { HttpApiBuilder, HttpServer } from "@effect/platform";
import * as Layer from "effect/Layer";

import { ControlPlaneApi } from "./api";
import {
  ControlPlaneActorResolver,
  type ControlPlaneActorResolverShape,
} from "./auth/actor-resolver";
import { ControlPlaneService } from "./service";
import { ControlPlaneApprovalsLive } from "./approvals/http";
import { ControlPlaneSourcesLive } from "./sources/http";

export const ControlPlaneApiLive = HttpApiBuilder.api(ControlPlaneApi).pipe(
  Layer.provide(ControlPlaneSourcesLive),
  Layer.provide(ControlPlaneApprovalsLive),
);

export const makeControlPlaneWebHandler = <EService, EResolver>(
  serviceLayer: Layer.Layer<ControlPlaneService, EService, never>,
  actorResolverLayer: Layer.Layer<ControlPlaneActorResolver, EResolver, never>,
) => {
  const apiLayer = ControlPlaneApiLive.pipe(
    Layer.provide(serviceLayer),
    Layer.provide(actorResolverLayer),
  );

  return HttpApiBuilder.toWebHandler(
    Layer.merge(apiLayer, HttpServer.layerContext),
  );
};

export const ControlPlaneActorResolverLive = (
  resolver: ControlPlaneActorResolverShape,
) => Layer.succeed(ControlPlaneActorResolver, resolver);
