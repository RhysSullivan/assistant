import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { ApprovalIdSchema, ApprovalSchema, WorkspaceIdSchema } from "@executor-v2/schema";
import * as Schema from "effect/Schema";

import {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "../errors";

export const ResolveApprovalStatusSchema = Schema.Literal("approved", "denied");

export const ResolveApprovalPayloadSchema = Schema.Struct({
  status: ResolveApprovalStatusSchema,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});

export type ResolveApprovalPayload = typeof ResolveApprovalPayloadSchema.Type;

const workspaceIdParam = HttpApiSchema.param("workspaceId", WorkspaceIdSchema);
const approvalIdParam = HttpApiSchema.param("approvalId", ApprovalIdSchema);

export class ApprovalsApi extends HttpApiGroup.make("approvals")
  .add(
    HttpApiEndpoint.get("list")`/workspaces/${workspaceIdParam}/approvals`
      .addSuccess(Schema.Array(ApprovalSchema))
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.post("resolve")`/workspaces/${workspaceIdParam}/approvals/${approvalIdParam}/resolve`
      .setPayload(ResolveApprovalPayloadSchema)
      .addSuccess(ApprovalSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneStorageError),
  )
  .prefix("/v1") {}
