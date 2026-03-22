import {
  Schema,
} from "effect";

import {
  TimestampMsSchema,
} from "../common";
import {
  ScopeIdSchema,
  ScopeOauthClientIdSchema,
} from "../ids";

export const ScopeOauthClientSchema = Schema.Struct({
  id: ScopeOauthClientIdSchema,
  scopeId: ScopeIdSchema,
  providerKey: Schema.String,
  label: Schema.NullOr(Schema.String),
  clientId: Schema.String,
  clientSecretProviderId: Schema.NullOr(Schema.String),
  clientSecretHandle: Schema.NullOr(Schema.String),
  clientMetadataJson: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export type ScopeOauthClient = typeof ScopeOauthClientSchema.Type;
