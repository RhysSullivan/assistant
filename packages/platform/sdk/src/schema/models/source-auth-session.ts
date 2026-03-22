import {
  Schema,
} from "effect";

import {
  TimestampMsSchema,
} from "../common";
import {
  ScopeIdSchema,
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  SourceIdSchema,
  SourceAuthSessionIdSchema,
  ScopeOauthClientIdSchema,
} from "../ids";
import {
  CredentialSlotSchema,
  OAuth2ClientAuthenticationMethodSchema,
  SecretRefSchema,
} from "./auth-artifact";

export const SourceAuthSessionProviderKindSchema = Schema.String;

export const SourceAuthSessionStatusSchema = Schema.Literal(
  "pending",
  "completed",
  "failed",
  "cancelled",
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | ReadonlyArray<JsonValue>;

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(JsonValueSchema),
    Schema.Record({
      key: Schema.String,
      value: JsonValueSchema,
    }),
  )
).annotations({ identifier: "JsonValue" });

export const JsonObjectSchema = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema,
}).annotations({ identifier: "JsonObject" });

export const McpSourceAuthSessionDataSchema = Schema.Struct({
  kind: Schema.Literal("mcp_oauth"),
  endpoint: Schema.String,
  redirectUri: Schema.String,
  scope: Schema.NullOr(Schema.String),
  resourceMetadataUrl: Schema.NullOr(Schema.String),
  authorizationServerUrl: Schema.NullOr(Schema.String),
  resourceMetadata: Schema.NullOr(JsonObjectSchema),
  authorizationServerMetadata: Schema.NullOr(JsonObjectSchema),
  clientInformation: Schema.NullOr(JsonObjectSchema),
  codeVerifier: Schema.NullOr(Schema.String),
  authorizationUrl: Schema.NullOr(Schema.String),
});

export const McpSourceAuthSessionDataJsonSchema = Schema.parseJson(
  McpSourceAuthSessionDataSchema,
);

export const OAuth2PkceSourceAuthSessionDataSchema = Schema.Struct({
  kind: Schema.Literal("oauth2_pkce"),
  providerKey: Schema.String,
  authorizationEndpoint: Schema.String,
  tokenEndpoint: Schema.String,
  redirectUri: Schema.String,
  clientId: Schema.String,
  clientAuthentication: OAuth2ClientAuthenticationMethodSchema,
  clientSecret: Schema.NullOr(SecretRefSchema),
  scopes: Schema.Array(Schema.String),
  headerName: Schema.String,
  prefix: Schema.String,
  authorizationParams: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
  codeVerifier: Schema.NullOr(Schema.String),
  authorizationUrl: Schema.NullOr(Schema.String),
});

export const OAuth2PkceSourceAuthSessionDataJsonSchema = Schema.parseJson(
  OAuth2PkceSourceAuthSessionDataSchema,
);

export const ProviderOauthTargetSourceSchema = Schema.Struct({
  sourceId: SourceIdSchema,
  requiredScopes: Schema.Array(Schema.String),
});

export const ProviderOauthBatchSourceAuthSessionDataSchema = Schema.Struct({
  kind: Schema.Literal("provider_oauth_batch"),
  providerKey: Schema.String,
  authorizationEndpoint: Schema.String,
  tokenEndpoint: Schema.String,
  redirectUri: Schema.String,
  oauthClientId: ScopeOauthClientIdSchema,
  clientAuthentication: OAuth2ClientAuthenticationMethodSchema,
  scopes: Schema.Array(Schema.String),
  headerName: Schema.String,
  prefix: Schema.String,
  authorizationParams: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
  targetSources: Schema.Array(ProviderOauthTargetSourceSchema),
  codeVerifier: Schema.NullOr(Schema.String),
  authorizationUrl: Schema.NullOr(Schema.String),
});

export const ProviderOauthBatchSourceAuthSessionDataJsonSchema = Schema.parseJson(
  ProviderOauthBatchSourceAuthSessionDataSchema,
);

export const SourceAuthSessionSchema = Schema.Struct({
  id: SourceAuthSessionIdSchema,
  scopeId: ScopeIdSchema,
  sourceId: SourceIdSchema,
  actorScopeId: Schema.NullOr(ScopeIdSchema),
  credentialSlot: CredentialSlotSchema,
  executionId: Schema.NullOr(ExecutionIdSchema),
  interactionId: Schema.NullOr(ExecutionInteractionIdSchema),
  providerKind: SourceAuthSessionProviderKindSchema,
  status: SourceAuthSessionStatusSchema,
  state: Schema.String,
  sessionDataJson: Schema.String,
  errorText: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(TimestampMsSchema),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export type SourceAuthSessionProviderKind = typeof SourceAuthSessionProviderKindSchema.Type;
export type SourceAuthSessionStatus = typeof SourceAuthSessionStatusSchema.Type;
export type McpSourceAuthSessionData = typeof McpSourceAuthSessionDataSchema.Type;
export type OAuth2PkceSourceAuthSessionData =
  typeof OAuth2PkceSourceAuthSessionDataSchema.Type;
export type ProviderOauthTargetSource = typeof ProviderOauthTargetSourceSchema.Type;
export type ProviderOauthBatchSourceAuthSessionData =
  typeof ProviderOauthBatchSourceAuthSessionDataSchema.Type;
export type SourceAuthSession = typeof SourceAuthSessionSchema.Type;
