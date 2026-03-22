import { HttpApiBuilder } from "@effect/platform";
import * as Layer from "effect/Layer";
import type { Executor } from "@executor/platform-sdk";

import { ControlPlaneApi } from "./api";
import { createControlPlaneExecutorLayer } from "./executor-context";
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

export const createControlPlaneApiLayer = (executor: Executor) =>
  ControlPlaneApiLive.pipe(
    Layer.provide(createControlPlaneExecutorLayer(executor)),
  );

export type BuiltControlPlaneApiLayer = ReturnType<
  typeof createControlPlaneApiLayer
>;

export const createExecutorApiLayer = (executor: Executor) =>
  createControlPlaneApiLayer(executor);
