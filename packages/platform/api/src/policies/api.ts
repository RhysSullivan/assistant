import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import {
  CreatePolicyPayloadSchema,
  UpdatePolicyPayloadSchema,
} from "@executor/platform-sdk/contracts";
import {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "@executor/platform-sdk/errors";
import {
  LocalWorkspacePolicySchema,
  PolicyIdSchema,
  WorkspaceIdSchema,
} from "@executor/platform-sdk/schema";
import * as Schema from "effect/Schema";

export type {
  CreatePolicyPayload,
  UpdatePolicyPayload,
} from "@executor/platform-sdk/contracts";

export {
  CreatePolicyPayloadSchema,
  UpdatePolicyPayloadSchema,
};

const workspaceIdParam = HttpApiSchema.param("workspaceId", WorkspaceIdSchema);
const policyIdParam = HttpApiSchema.param("policyId", PolicyIdSchema);

export class PoliciesApi extends HttpApiGroup.make("policies")
  .add(
    HttpApiEndpoint.get("list")`/workspaces/${workspaceIdParam}/policies`
      .addSuccess(Schema.Array(LocalWorkspacePolicySchema))
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.post("create")`/workspaces/${workspaceIdParam}/policies`
      .setPayload(CreatePolicyPayloadSchema)
      .addSuccess(LocalWorkspacePolicySchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get("get")`/workspaces/${workspaceIdParam}/policies/${policyIdParam}`
      .addSuccess(LocalWorkspacePolicySchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.patch("update")`/workspaces/${workspaceIdParam}/policies/${policyIdParam}`
      .setPayload(UpdatePolicyPayloadSchema)
      .addSuccess(LocalWorkspacePolicySchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.del("remove")`/workspaces/${workspaceIdParam}/policies/${policyIdParam}`
      .addSuccess(Schema.Struct({ removed: Schema.Boolean }))
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .prefix("/v1") {}
