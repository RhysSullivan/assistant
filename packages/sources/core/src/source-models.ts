import * as Schema from "effect/Schema";

export const SecretRefSchema = Schema.Struct({
  providerId: Schema.String,
  handle: Schema.String,
});

export const CredentialSlotSchema = Schema.Literal("runtime", "import");

export const SourceCatalogKindSchema = Schema.Literal(
  "imported",
  "internal",
);

export const SourceKindSchema = Schema.String;

export const SourceStatusSchema = Schema.Literal(
  "draft",
  "probing",
  "auth_required",
  "connected",
  "error",
);

export const SourceTransportSchema = Schema.Literal(
  "auto",
  "streamable-http",
  "sse",
);

export const SourceImportAuthPolicySchema = Schema.Literal(
  "none",
  "reuse_runtime",
  "separate",
);

export const StringMapSchema = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});

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

export const SourceAuthSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("none"),
  }),
  Schema.Struct({
    kind: Schema.Literal("bearer"),
    headerName: Schema.String,
    prefix: Schema.String,
    token: SecretRefSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth2"),
    headerName: Schema.String,
    prefix: Schema.String,
    accessToken: SecretRefSchema,
    refreshToken: Schema.NullOr(SecretRefSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth2_authorized_user"),
    headerName: Schema.String,
    prefix: Schema.String,
    tokenEndpoint: Schema.String,
    clientId: Schema.String,
    clientAuthentication: Schema.Literal("none", "client_secret_post"),
    clientSecret: Schema.NullOr(SecretRefSchema),
    refreshToken: SecretRefSchema,
    grantSet: Schema.NullOr(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literal("provider_grant_ref"),
    grantId: Schema.String,
    providerKey: Schema.String,
    requiredScopes: Schema.Array(Schema.String),
    headerName: Schema.String,
    prefix: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("mcp_oauth"),
    redirectUri: Schema.String,
    accessToken: SecretRefSchema,
    refreshToken: Schema.NullOr(SecretRefSchema),
    tokenType: Schema.String,
    expiresIn: Schema.NullOr(Schema.Number),
    scope: Schema.NullOr(Schema.String),
    resourceMetadataUrl: Schema.NullOr(Schema.String),
    authorizationServerUrl: Schema.NullOr(Schema.String),
    resourceMetadataJson: Schema.NullOr(Schema.String),
    authorizationServerMetadataJson: Schema.NullOr(Schema.String),
    clientInformationJson: Schema.NullOr(Schema.String),
  }),
);

export const SourceBindingVersionSchema = Schema.Number;

export const SourceBindingSchema = Schema.Struct({
  version: SourceBindingVersionSchema,
  payload: JsonObjectSchema,
});

export const SourceSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  name: Schema.String,
  kind: SourceKindSchema,
  endpoint: Schema.String,
  status: SourceStatusSchema,
  enabled: Schema.Boolean,
  namespace: Schema.NullOr(Schema.String),
  bindingVersion: SourceBindingVersionSchema,
  binding: JsonObjectSchema,
  importAuthPolicy: SourceImportAuthPolicySchema,
  importAuth: SourceAuthSchema,
  auth: SourceAuthSchema,
  sourceHash: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export const StoredSourceRecordSchema = Schema.Struct({
  id: Schema.String,
  bindingConfigJson: Schema.NullOr(Schema.String),
});

export const WorkspaceSourceOauthClientRedirectModeSchema = Schema.Literal(
  "app_callback",
  "loopback",
);

export const WorkspaceOauthClientIdSchema = Schema.String;

export const SourceOauthClientInputSchema = Schema.Struct({
  clientId: Schema.Trim.pipe(Schema.nonEmptyString()),
  clientSecret: Schema.optional(
    Schema.NullOr(Schema.Trim.pipe(Schema.nonEmptyString())),
  ),
  redirectMode: Schema.optional(WorkspaceSourceOauthClientRedirectModeSchema),
});

export type SecretRef = typeof SecretRefSchema.Type;
export type CredentialSlot = typeof CredentialSlotSchema.Type;
export type SourceCatalogKind = typeof SourceCatalogKindSchema.Type;
export type SourceKind = typeof SourceKindSchema.Type;
export type SourceStatus = typeof SourceStatusSchema.Type;
export type SourceTransport = typeof SourceTransportSchema.Type;
export type SourceImportAuthPolicy = typeof SourceImportAuthPolicySchema.Type;
export type StringMap = typeof StringMapSchema.Type;
export type SourceAuth = typeof SourceAuthSchema.Type;
export type SourceBinding = typeof SourceBindingSchema.Type;
export type Source = typeof SourceSchema.Type;
export type StoredSourceRecord = typeof StoredSourceRecordSchema.Type;
export type WorkspaceSourceOauthClientRedirectMode =
  typeof WorkspaceSourceOauthClientRedirectModeSchema.Type;
export type SourceOauthClientInput = typeof SourceOauthClientInputSchema.Type;
