import {
  LocalScopePolicyApprovalModeSchema,
  LocalScopePolicyEffectSchema,
} from "../schema";
import * as Schema from "effect/Schema";

import {
  OptionalTrimmedNonEmptyStringSchema,
} from "../string-schemas";

const LocalScopePolicyPayloadSchema = Schema.Struct({
  resourcePattern: OptionalTrimmedNonEmptyStringSchema,
  effect: Schema.optional(LocalScopePolicyEffectSchema),
  approvalMode: Schema.optional(LocalScopePolicyApprovalModeSchema),
  priority: Schema.optional(Schema.Number),
  enabled: Schema.optional(Schema.Boolean),
});

export const CreatePolicyPayloadSchema = LocalScopePolicyPayloadSchema;

export type CreatePolicyPayload = typeof CreatePolicyPayloadSchema.Type;

export const UpdatePolicyPayloadSchema = LocalScopePolicyPayloadSchema;

export type UpdatePolicyPayload = typeof UpdatePolicyPayloadSchema.Type;
