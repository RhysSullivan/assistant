import {
  Schema,
} from "effect";

import {
  TimestampMsSchema,
} from "../common";
import {
  ScopeIdSchema,
  ProviderAuthGrantIdSchema,
  ScopeOauthClientIdSchema,
} from "../ids";

import {
  OAuth2ClientAuthenticationMethodSchema,
  SecretRefSchema,
} from "./auth-artifact";

export const ProviderAuthGrantSchema = Schema.Struct({
  id: ProviderAuthGrantIdSchema,
  scopeId: ScopeIdSchema,
  actorScopeId: Schema.NullOr(ScopeIdSchema),
  providerKey: Schema.String,
  oauthClientId: ScopeOauthClientIdSchema,
  tokenEndpoint: Schema.String,
  clientAuthentication: OAuth2ClientAuthenticationMethodSchema,
  headerName: Schema.String,
  prefix: Schema.String,
  refreshToken: SecretRefSchema,
  grantedScopes: Schema.Array(Schema.String),
  lastRefreshedAt: Schema.NullOr(TimestampMsSchema),
  orphanedAt: Schema.NullOr(TimestampMsSchema),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export type ProviderAuthGrant = typeof ProviderAuthGrantSchema.Type;
