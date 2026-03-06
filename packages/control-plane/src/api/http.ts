import { HttpApiBuilder } from "@effect/platform";
import * as Layer from "effect/Layer";

import { ControlPlaneApi } from "./api";
import {
  ControlPlaneActorResolver,
  type ControlPlaneActorResolverShape,
} from "./auth/actor-resolver";
import { ControlPlaneExecutionsLive } from "./executions/http";
import { ControlPlaneLocalLive } from "./local/http";
import { ControlPlaneMembershipsLive } from "./memberships/http";
import { ControlPlaneOrganizationsLive } from "./organizations/http";
import { ControlPlanePoliciesLive } from "./policies/http";
import { ControlPlaneService } from "./service";
import { ControlPlaneSourcesLive } from "./sources/http";
import { ControlPlaneWorkspacesLive } from "./workspaces/http";

export const ControlPlaneApiLive = HttpApiBuilder.api(ControlPlaneApi).pipe(
  Layer.provide(ControlPlaneLocalLive),
  Layer.provide(ControlPlaneOrganizationsLive),
  Layer.provide(ControlPlaneMembershipsLive),
  Layer.provide(ControlPlaneWorkspacesLive),
  Layer.provide(ControlPlaneSourcesLive),
  Layer.provide(ControlPlanePoliciesLive),
  Layer.provide(ControlPlaneExecutionsLive),
);

export const createControlPlaneApiLayer = <EService, EResolver>(
  serviceLayer: Layer.Layer<ControlPlaneService, EService, never>,
  actorResolverLayer: Layer.Layer<ControlPlaneActorResolver, EResolver, never>,
) =>
  ControlPlaneApiLive.pipe(
    Layer.provide(serviceLayer),
    Layer.provide(actorResolverLayer),
  );

export const ControlPlaneActorResolverLive = (
  resolver: ControlPlaneActorResolverShape,
) => Layer.succeed(ControlPlaneActorResolver, resolver);
