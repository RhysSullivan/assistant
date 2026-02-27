import { SourceCatalog, SourceCatalogLive } from "@executor-v2/source-manager/source-catalog";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  makeControlPlaneSourcesService,
  type ControlPlaneSourcesServiceShape,
} from "./sources/service";

export type ControlPlaneServiceShape = ControlPlaneSourcesServiceShape;

export class ControlPlaneService extends Context.Tag("@executor-v2/control-plane/ControlPlaneService")<
  ControlPlaneService,
  ControlPlaneServiceShape
>() {}

export const makeControlPlaneService = (
  services: {
    sources: ControlPlaneSourcesServiceShape;
  },
): ControlPlaneServiceShape => ({
  ...services.sources,
});

export const ControlPlaneServiceLive = Layer.effect(
  ControlPlaneService,
  Effect.gen(function* () {
    const sourceCatalog = yield* SourceCatalog;

    return ControlPlaneService.of(
      makeControlPlaneService({
        sources: makeControlPlaneSourcesService(sourceCatalog),
      }),
    );
  }),
).pipe(Layer.provide(SourceCatalogLive));
