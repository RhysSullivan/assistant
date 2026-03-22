import {
  Schema,
} from "effect";
import * as Option from "effect/Option";

import {
  TimestampMsSchema,
} from "../common";
import {
  ScopeIdSchema,
  AuthArtifactIdSchema,
  ProviderAuthGrantIdSchema,
  SourceIdSchema,
} from "../ids";

export const SecretRefSchema = Schema.Struct({
  providerId: Schema.String,
  handle: Schema.String,
});

export const AuthArtifactSlotSchema = Schema.Literal("runtime", "import");
export const CredentialSlotSchema = AuthArtifactSlotSchema;

export const AuthArtifactKindSchema = Schema.String;
export const AuthGrantSetSchema = Schema.Array(Schema.String);

export const RequestPlacementPartSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("literal"),
    value: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("secret_ref"),
    ref: SecretRefSchema,
  }),
);

export const RequestPlacementTemplateSchema = Schema.Union(
  Schema.Struct({
    location: Schema.Literal("header"),
    name: Schema.String,
    parts: Schema.Array(RequestPlacementPartSchema),
  }),
  Schema.Struct({
    location: Schema.Literal("query"),
    name: Schema.String,
    parts: Schema.Array(RequestPlacementPartSchema),
  }),
  Schema.Struct({
    location: Schema.Literal("cookie"),
    name: Schema.String,
    parts: Schema.Array(RequestPlacementPartSchema),
  }),
  Schema.Struct({
    location: Schema.Literal("body"),
    path: Schema.String,
    parts: Schema.Array(RequestPlacementPartSchema),
  }),
);

export const RequestPlacementSchema = Schema.Union(
  Schema.Struct({
    location: Schema.Literal("header"),
    name: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({
    location: Schema.Literal("query"),
    name: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({
    location: Schema.Literal("cookie"),
    name: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({
    location: Schema.Literal("body"),
    path: Schema.String,
    value: Schema.String,
  }),
);

export const RequestPlacementTemplatesJsonSchema = Schema.parseJson(
  Schema.Array(RequestPlacementTemplateSchema),
);

export const StaticBearerAuthArtifactKind = "static_bearer" as const;
export const StaticOAuth2AuthArtifactKind = "static_oauth2" as const;
export const StaticPlacementsAuthArtifactKind = "static_placements" as const;
export const RefreshableOAuth2AuthorizedUserAuthArtifactKind =
  "oauth2_authorized_user" as const;
export const ProviderGrantRefAuthArtifactKind = "provider_grant_ref" as const;
export const McpOAuthAuthArtifactKind = "mcp_oauth" as const;

export const OAuth2ClientAuthenticationMethodSchema = Schema.Literal(
  "none",
  "client_secret_post",
);

export const BuiltInAuthArtifactKindSchema = Schema.Literal(
  StaticBearerAuthArtifactKind,
  StaticOAuth2AuthArtifactKind,
  StaticPlacementsAuthArtifactKind,
  RefreshableOAuth2AuthorizedUserAuthArtifactKind,
);

export const StaticBearerAuthArtifactConfigSchema = Schema.Struct({
  headerName: Schema.String,
  prefix: Schema.String,
  token: SecretRefSchema,
});

export const StaticOAuth2AuthArtifactConfigSchema = Schema.Struct({
  headerName: Schema.String,
  prefix: Schema.String,
  accessToken: SecretRefSchema,
  refreshToken: Schema.NullOr(SecretRefSchema),
});

export const StaticPlacementsAuthArtifactConfigSchema = Schema.Struct({
  placements: Schema.Array(RequestPlacementTemplateSchema),
});

export const RefreshableOAuth2AuthorizedUserAuthArtifactConfigSchema = Schema.Struct({
  headerName: Schema.String,
  prefix: Schema.String,
  tokenEndpoint: Schema.String,
  clientId: Schema.String,
  clientAuthentication: OAuth2ClientAuthenticationMethodSchema,
  clientSecret: Schema.NullOr(SecretRefSchema),
  refreshToken: SecretRefSchema,
});

export const ProviderGrantRefAuthArtifactConfigSchema = Schema.Struct({
  grantId: ProviderAuthGrantIdSchema,
  providerKey: Schema.String,
  requiredScopes: Schema.Array(Schema.String),
  headerName: Schema.String,
  prefix: Schema.String,
});

export const McpOAuthAuthArtifactConfigSchema = Schema.Struct({
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
});

export const StaticBearerAuthArtifactConfigJsonSchema = Schema.parseJson(
  StaticBearerAuthArtifactConfigSchema,
);

export const StaticOAuth2AuthArtifactConfigJsonSchema = Schema.parseJson(
  StaticOAuth2AuthArtifactConfigSchema,
);

export const StaticPlacementsAuthArtifactConfigJsonSchema = Schema.parseJson(
  StaticPlacementsAuthArtifactConfigSchema,
);

export const RefreshableOAuth2AuthorizedUserAuthArtifactConfigJsonSchema = Schema.parseJson(
  RefreshableOAuth2AuthorizedUserAuthArtifactConfigSchema,
);

export const ProviderGrantRefAuthArtifactConfigJsonSchema = Schema.parseJson(
  ProviderGrantRefAuthArtifactConfigSchema,
);

export const McpOAuthAuthArtifactConfigJsonSchema = Schema.parseJson(
  McpOAuthAuthArtifactConfigSchema,
);

export const RequestPlacementsJsonSchema = Schema.parseJson(
  Schema.Array(RequestPlacementSchema),
);

export const AuthGrantSetJsonSchema = Schema.parseJson(AuthGrantSetSchema);

const decodeStaticBearerAuthArtifactConfigOption = Schema.decodeUnknownOption(
  StaticBearerAuthArtifactConfigJsonSchema,
);

const decodeStaticOAuth2AuthArtifactConfigOption = Schema.decodeUnknownOption(
  StaticOAuth2AuthArtifactConfigJsonSchema,
);

const decodeStaticPlacementsAuthArtifactConfigOption = Schema.decodeUnknownOption(
  StaticPlacementsAuthArtifactConfigJsonSchema,
);

const decodeRefreshableOAuth2AuthorizedUserAuthArtifactConfigOption = Schema.decodeUnknownOption(
  RefreshableOAuth2AuthorizedUserAuthArtifactConfigJsonSchema,
);
const decodeProviderGrantRefAuthArtifactConfigOption = Schema.decodeUnknownOption(
  ProviderGrantRefAuthArtifactConfigJsonSchema,
);
const decodeMcpOAuthAuthArtifactConfigOption = Schema.decodeUnknownOption(
  McpOAuthAuthArtifactConfigJsonSchema,
);

const decodeAuthGrantSetOption = Schema.decodeUnknownOption(AuthGrantSetJsonSchema);

export const AuthArtifactSchema = Schema.Struct({
  id: AuthArtifactIdSchema,
  scopeId: ScopeIdSchema,
  sourceId: SourceIdSchema,
  actorScopeId: Schema.NullOr(ScopeIdSchema),
  slot: AuthArtifactSlotSchema,
  artifactKind: AuthArtifactKindSchema,
  configJson: Schema.String,
  grantSetJson: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export type SecretRef = typeof SecretRefSchema.Type;
export type AuthArtifactSlot = typeof AuthArtifactSlotSchema.Type;
export type CredentialSlot = typeof CredentialSlotSchema.Type;
export type AuthArtifactKind = typeof AuthArtifactKindSchema.Type;
export type AuthGrantSet = typeof AuthGrantSetSchema.Type;
export type RequestPlacementPart = typeof RequestPlacementPartSchema.Type;
export type RequestPlacementTemplate = typeof RequestPlacementTemplateSchema.Type;
export type RequestPlacement = typeof RequestPlacementSchema.Type;
export type OAuth2ClientAuthenticationMethod =
  typeof OAuth2ClientAuthenticationMethodSchema.Type;
export type BuiltInAuthArtifactKind = typeof BuiltInAuthArtifactKindSchema.Type;
export type StaticBearerAuthArtifactConfig = typeof StaticBearerAuthArtifactConfigSchema.Type;
export type StaticOAuth2AuthArtifactConfig = typeof StaticOAuth2AuthArtifactConfigSchema.Type;
export type StaticPlacementsAuthArtifactConfig = typeof StaticPlacementsAuthArtifactConfigSchema.Type;
export type RefreshableOAuth2AuthorizedUserAuthArtifactConfig =
  typeof RefreshableOAuth2AuthorizedUserAuthArtifactConfigSchema.Type;
export type ProviderGrantRefAuthArtifactConfig =
  typeof ProviderGrantRefAuthArtifactConfigSchema.Type;
export type McpOAuthAuthArtifactConfig = typeof McpOAuthAuthArtifactConfigSchema.Type;
export type AuthArtifact = typeof AuthArtifactSchema.Type;

export type DecodedBuiltInAuthArtifactConfig =
  | {
      artifactKind: typeof StaticBearerAuthArtifactKind;
      config: StaticBearerAuthArtifactConfig;
    }
  | {
      artifactKind: typeof StaticOAuth2AuthArtifactKind;
      config: StaticOAuth2AuthArtifactConfig;
    }
  | {
      artifactKind: typeof StaticPlacementsAuthArtifactKind;
      config: StaticPlacementsAuthArtifactConfig;
    }
  | {
      artifactKind: typeof RefreshableOAuth2AuthorizedUserAuthArtifactKind;
      config: RefreshableOAuth2AuthorizedUserAuthArtifactConfig;
    };

export const decodeProviderGrantRefAuthArtifactConfig = (
  artifact: Pick<AuthArtifact, "artifactKind" | "configJson">,
): ProviderGrantRefAuthArtifactConfig | null => {
  if (artifact.artifactKind !== ProviderGrantRefAuthArtifactKind) {
    return null;
  }

  const decoded = decodeProviderGrantRefAuthArtifactConfigOption(artifact.configJson);
  return Option.isSome(decoded) ? decoded.value : null;
};

export const decodeMcpOAuthAuthArtifactConfig = (
  artifact: Pick<AuthArtifact, "artifactKind" | "configJson">,
): McpOAuthAuthArtifactConfig | null => {
  if (artifact.artifactKind !== McpOAuthAuthArtifactKind) {
    return null;
  }

  const decoded = decodeMcpOAuthAuthArtifactConfigOption(artifact.configJson);
  return Option.isSome(decoded) ? decoded.value : null;
};

export const decodeBuiltInAuthArtifactConfig = (
  artifact: Pick<AuthArtifact, "artifactKind" | "configJson">,
): DecodedBuiltInAuthArtifactConfig | null => {
  switch (artifact.artifactKind) {
    case StaticBearerAuthArtifactKind: {
      const decoded = decodeStaticBearerAuthArtifactConfigOption(artifact.configJson);
      return Option.isSome(decoded)
        ? { artifactKind: StaticBearerAuthArtifactKind, config: decoded.value }
        : null;
    }
    case StaticOAuth2AuthArtifactKind: {
      const decoded = decodeStaticOAuth2AuthArtifactConfigOption(artifact.configJson);
      return Option.isSome(decoded)
        ? { artifactKind: StaticOAuth2AuthArtifactKind, config: decoded.value }
        : null;
    }
    case StaticPlacementsAuthArtifactKind: {
      const decoded = decodeStaticPlacementsAuthArtifactConfigOption(artifact.configJson);
      return Option.isSome(decoded)
        ? { artifactKind: StaticPlacementsAuthArtifactKind, config: decoded.value }
        : null;
    }
    case RefreshableOAuth2AuthorizedUserAuthArtifactKind: {
      const decoded = decodeRefreshableOAuth2AuthorizedUserAuthArtifactConfigOption(
        artifact.configJson,
      );
      return Option.isSome(decoded)
        ? {
            artifactKind: RefreshableOAuth2AuthorizedUserAuthArtifactKind,
            config: decoded.value,
          }
        : null;
    }
    default:
      return null;
  }
};

export const decodeAuthArtifactGrantSet = (
  artifact: Pick<AuthArtifact, "grantSetJson"> | string | null,
): AuthGrantSet | null => {
  const grantSetJson = artifact !== null && typeof artifact === "object"
    ? artifact.grantSetJson
    : artifact;

  if (grantSetJson === null) {
    return null;
  }

  const decoded = decodeAuthGrantSetOption(grantSetJson);
  return Option.isSome(decoded) ? decoded.value : null;
};

export const decodeAuthGrantSet = decodeAuthArtifactGrantSet;

export const authArtifactSecretRefs = (
  artifact: Pick<AuthArtifact, "artifactKind" | "configJson">,
): ReadonlyArray<SecretRef> => {
  const decoded = decodeBuiltInAuthArtifactConfig(artifact);
  if (decoded !== null) {
    switch (decoded.artifactKind) {
      case StaticBearerAuthArtifactKind:
        return [decoded.config.token];
      case StaticOAuth2AuthArtifactKind:
        return decoded.config.refreshToken
          ? [decoded.config.accessToken, decoded.config.refreshToken]
          : [decoded.config.accessToken];
      case StaticPlacementsAuthArtifactKind:
        return decoded.config.placements.flatMap((placement) =>
          placement.parts.flatMap((part) =>
            part.kind === "secret_ref" ? [part.ref] : [],
          )
        );
      case RefreshableOAuth2AuthorizedUserAuthArtifactKind:
        return decoded.config.clientSecret
          ? [decoded.config.refreshToken, decoded.config.clientSecret]
          : [decoded.config.refreshToken];
    }
  }

  const mcpOAuthConfig = decodeMcpOAuthAuthArtifactConfig(artifact);
  if (mcpOAuthConfig !== null) {
    return mcpOAuthConfig.refreshToken
      ? [mcpOAuthConfig.accessToken, mcpOAuthConfig.refreshToken]
      : [mcpOAuthConfig.accessToken];
  }

  return [];
};

export const authArtifactSecretMaterialRefs = authArtifactSecretRefs;
