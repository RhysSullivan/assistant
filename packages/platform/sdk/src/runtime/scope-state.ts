import {
  PolicyIdSchema,
  SourceStatusSchema,
  TimestampMsSchema,
} from "#schema";
import * as Schema from "effect/Schema";

const LocalWorkspaceSourceStateSchema = Schema.Struct({
  status: SourceStatusSchema,
  lastError: Schema.NullOr(Schema.String),
  sourceHash: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

const LocalScopePolicyStateSchema = Schema.Struct({
  id: PolicyIdSchema,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const LocalScopeStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  sources: Schema.Record({
    key: Schema.String,
    value: LocalWorkspaceSourceStateSchema,
  }),
  policies: Schema.Record({
    key: Schema.String,
    value: LocalScopePolicyStateSchema,
  }),
});

export type LocalWorkspaceSourceState = typeof LocalWorkspaceSourceStateSchema.Type;
export type LocalScopePolicyState = typeof LocalScopePolicyStateSchema.Type;
export type LocalScopeState = typeof LocalScopeStateSchema.Type;

export const defaultLocalScopeState = (): LocalScopeState => ({
  version: 1,
  sources: {},
  policies: {},
});
