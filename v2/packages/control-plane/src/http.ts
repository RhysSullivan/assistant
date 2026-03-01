import { HttpApiBuilder, HttpServer } from "@effect/platform";
import * as Layer from "effect/Layer";

import { ControlPlaneApi } from "./api";
import { ControlPlaneService } from "./service";
import { ControlPlaneSourcesLive } from "./sources/http";

export const ControlPlaneApiLive = HttpApiBuilder.api(ControlPlaneApi).pipe(
  Layer.provide(ControlPlaneSourcesLive),
);

export const makeControlPlaneWebHandler = <E>(
  serviceLayer: Layer.Layer<ControlPlaneService, E, never>,
) =>
  HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      ControlPlaneApiLive.pipe(Layer.provide(serviceLayer)),
      HttpServer.layerContext,
    ),
  );
