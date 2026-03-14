import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import {
  AccountIdSchema,
  PolicyIdSchema,
  PolicyApprovalModeSchema,
  PolicyEffectSchema,
  PolicyMatchTypeSchema,
  PolicyResourceTypeSchema,
  PolicySchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Schema from "effect/Schema";

import {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "../errors";
import { OptionalTrimmedNonEmptyStringSchema } from "../string-schemas";

export const CreatePolicyPayloadSchema = Schema.Struct({
  resourceType: Schema.optional(PolicyResourceTypeSchema),
  resourcePattern: OptionalTrimmedNonEmptyStringSchema,
  matchType: Schema.optional(PolicyMatchTypeSchema),
  effect: Schema.optional(PolicyEffectSchema),
  approvalMode: Schema.optional(PolicyApprovalModeSchema),
  argumentConditionsJson: Schema.optional(Schema.NullOr(Schema.String)),
  priority: Schema.optional(Schema.Number),
  enabled: Schema.optional(Schema.Boolean),
  targetAccountId: Schema.optional(Schema.NullOr(AccountIdSchema)),
  clientId: Schema.optional(Schema.NullOr(Schema.String)),
});

export type CreatePolicyPayload = typeof CreatePolicyPayloadSchema.Type;

export const UpdatePolicyPayloadSchema = Schema.Struct({
  resourceType: Schema.optional(PolicyResourceTypeSchema),
  resourcePattern: OptionalTrimmedNonEmptyStringSchema,
  matchType: Schema.optional(PolicyMatchTypeSchema),
  effect: Schema.optional(PolicyEffectSchema),
  approvalMode: Schema.optional(PolicyApprovalModeSchema),
  argumentConditionsJson: Schema.optional(Schema.NullOr(Schema.String)),
  priority: Schema.optional(Schema.Number),
  enabled: Schema.optional(Schema.Boolean),
  targetAccountId: Schema.optional(Schema.NullOr(AccountIdSchema)),
  clientId: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UpdatePolicyPayload = typeof UpdatePolicyPayloadSchema.Type;

const workspaceIdParam = HttpApiSchema.param("workspaceId", WorkspaceIdSchema);
const policyIdParam = HttpApiSchema.param("policyId", PolicyIdSchema);

export class PoliciesApi extends HttpApiGroup.make("policies")
  .add(
    HttpApiEndpoint.get("list")`/workspaces/${workspaceIdParam}/policies`
      .addSuccess(Schema.Array(PolicySchema))
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.post("create")`/workspaces/${workspaceIdParam}/policies`
      .setPayload(CreatePolicyPayloadSchema)
      .addSuccess(PolicySchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get("get")`/workspaces/${workspaceIdParam}/policies/${policyIdParam}`
      .addSuccess(PolicySchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.patch("update")`/workspaces/${workspaceIdParam}/policies/${policyIdParam}`
      .setPayload(UpdatePolicyPayloadSchema)
      .addSuccess(PolicySchema)
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
