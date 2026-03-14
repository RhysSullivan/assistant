import { HttpApiBuilder } from "@effect/platform";
import * as Layer from "effect/Layer";

import { ControlPlaneApi } from "./api";
import {
  ControlPlaneActorResolver,
  type ControlPlaneActorResolverShape,
} from "./auth/actor-resolver";
import { ControlPlaneExecutionsLive } from "./executions/http";
import { ControlPlaneLocalLive } from "./local/http";
import { ControlPlaneOAuthLive } from "./oauth/http";
import { ControlPlanePoliciesLive } from "./policies/http";
import { ControlPlaneSourcesLive } from "./sources/http";

export const ControlPlaneApiLive = HttpApiBuilder.api(ControlPlaneApi).pipe(
  Layer.provide(ControlPlaneLocalLive),
  Layer.provide(ControlPlaneOAuthLive),
  Layer.provide(ControlPlaneSourcesLive),
  Layer.provide(ControlPlanePoliciesLive),
  Layer.provide(ControlPlaneExecutionsLive),
);

export type ControlPlaneApiRuntimeContext = Layer.Layer.Context<typeof ControlPlaneApiLive>;

export type BuiltControlPlaneApiLayer = Layer.Layer<
  Layer.Layer.Success<typeof ControlPlaneApiLive>,
  Layer.Layer.Error<typeof ControlPlaneApiLive>,
  never
>;

export const createControlPlaneApiLayer = <ERuntime>(
  runtimeLayer: Layer.Layer<ControlPlaneApiRuntimeContext, ERuntime, never>,
) =>
  ControlPlaneApiLive.pipe(
    Layer.provide(runtimeLayer),
  );

export const ControlPlaneActorResolverLive = (
  resolver: ControlPlaneActorResolverShape,
) => Layer.succeed(ControlPlaneActorResolver, resolver);
