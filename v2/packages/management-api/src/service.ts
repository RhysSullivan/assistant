import * as Context from "effect/Context";

import { type ControlPlaneApprovalsServiceShape } from "./approvals/service";
import { type ControlPlaneSourcesServiceShape } from "./sources/service";

export type ControlPlaneServiceShape = ControlPlaneSourcesServiceShape &
  ControlPlaneApprovalsServiceShape;

export class ControlPlaneService extends Context.Tag("@executor-v2/management-api/ControlPlaneService")<
  ControlPlaneService,
  ControlPlaneServiceShape
>() {}

export const makeControlPlaneService = (services: {
  sources: ControlPlaneSourcesServiceShape;
  approvals: ControlPlaneApprovalsServiceShape;
}): ControlPlaneServiceShape => ({
  ...services.sources,
  ...services.approvals,
});
