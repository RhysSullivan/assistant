import {
  Schema,
} from "effect";

import {
  TimestampMsSchema,
} from "../common";
import {
  PolicyIdSchema,
  ScopeIdSchema,
} from "../ids";

export const LocalScopePolicyEffectSchema = Schema.Literal("allow", "deny");
export const LocalScopePolicyApprovalModeSchema = Schema.Literal("auto", "required");

export const LocalScopePolicySchema = Schema.Struct({
  id: PolicyIdSchema,
  key: Schema.String,
  scopeId: ScopeIdSchema,
  resourcePattern: Schema.String,
  effect: LocalScopePolicyEffectSchema,
  approvalMode: LocalScopePolicyApprovalModeSchema,
  priority: Schema.Number,
  enabled: Schema.Boolean,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const LocalScopePolicyInsertSchema = LocalScopePolicySchema;
export const LocalScopePolicyUpdateSchema = Schema.partial(LocalScopePolicySchema);

export type LocalScopePolicyEffect = typeof LocalScopePolicyEffectSchema.Type;
export type LocalScopePolicyApprovalMode =
  typeof LocalScopePolicyApprovalModeSchema.Type;
export type LocalScopePolicy = typeof LocalScopePolicySchema.Type;
