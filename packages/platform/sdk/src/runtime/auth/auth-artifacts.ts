import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  type ScopeId,
  AuthGrantSetJsonSchema,
  McpOAuthAuthArtifactConfigJsonSchema,
  McpOAuthAuthArtifactKind,
  ProviderGrantRefAuthArtifactConfigJsonSchema,
  ProviderGrantRefAuthArtifactKind,
  RequestPlacementTemplatesJsonSchema,
  RefreshableOAuth2AuthorizedUserAuthArtifactConfigJsonSchema,
  RefreshableOAuth2AuthorizedUserAuthArtifactKind,
  StaticBearerAuthArtifactConfigJsonSchema,
  StaticBearerAuthArtifactKind,
  StaticOAuth2AuthArtifactConfigJsonSchema,
  StaticOAuth2AuthArtifactKind,
  StaticPlacementsAuthArtifactConfigJsonSchema,
  StaticPlacementsAuthArtifactKind,
  authArtifactSecretRefs,
  decodeAuthGrantSet,
  decodeBuiltInAuthArtifactConfig,
  decodeMcpOAuthAuthArtifactConfig,
  decodeProviderGrantRefAuthArtifactConfig,
  type AuthArtifact,
  type CredentialSlot,
  type RequestPlacement,
  type RequestPlacementPart,
  type SecretRef,
  type Source,
  type SourceAuth,
} from "#schema";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type {
  ResolveSecretMaterial,
  SecretMaterialResolveContext,
} from "../scope/secret-material-providers";
import {
  runtimeEffectError,
} from "../effect-errors";

export type ResolvedSourceAuthMaterial = {
  placements: ReadonlyArray<RequestPlacement>;
  headers: Readonly<Record<string, string>>;
  queryParams: Readonly<Record<string, string>>;
  cookies: Readonly<Record<string, string>>;
  bodyValues: Readonly<Record<string, string>>;
  expiresAt: number | null;
  refreshAfter: number | null;
  authProvider?: OAuthClientProvider | undefined;
};

const emptyResolvedAuthMaterial: ResolvedSourceAuthMaterial = {
  placements: [],
  headers: {},
  queryParams: {},
  cookies: {},
  bodyValues: {},
  expiresAt: null,
  refreshAfter: null,
  authProvider: undefined,
};

const encodeStaticBearerAuthArtifactConfig = Schema.encodeSync(
  StaticBearerAuthArtifactConfigJsonSchema,
);

const encodeStaticOAuth2AuthArtifactConfig = Schema.encodeSync(
  StaticOAuth2AuthArtifactConfigJsonSchema,
);

const encodeStaticPlacementsAuthArtifactConfig = Schema.encodeSync(
  StaticPlacementsAuthArtifactConfigJsonSchema,
);
const encodeRefreshableOAuth2AuthorizedUserAuthArtifactConfig = Schema.encodeSync(
  RefreshableOAuth2AuthorizedUserAuthArtifactConfigJsonSchema,
);
const encodeProviderGrantRefAuthArtifactConfig = Schema.encodeSync(
  ProviderGrantRefAuthArtifactConfigJsonSchema,
);
const encodeMcpOAuthAuthArtifactConfig = Schema.encodeSync(
  McpOAuthAuthArtifactConfigJsonSchema,
);

const decodeRequestPlacementTemplates = Schema.decodeUnknownEither(
  RequestPlacementTemplatesJsonSchema,
);
const encodeAuthGrantSet = Schema.encodeSync(AuthGrantSetJsonSchema);

const mergePlacement = (acc: {
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  cookies: Record<string, string>;
  bodyValues: Record<string, string>;
}, placement: RequestPlacement) => {
  switch (placement.location) {
    case "header":
      acc.headers[placement.name] = placement.value;
      break;
    case "query":
      acc.queryParams[placement.name] = placement.value;
      break;
    case "cookie":
      acc.cookies[placement.name] = placement.value;
      break;
    case "body":
      acc.bodyValues[placement.path] = placement.value;
      break;
  }
};

const summarizeResolvedPlacements = (placements: ReadonlyArray<RequestPlacement>, input: {
  expiresAt?: number | null;
  refreshAfter?: number | null;
} = {}): ResolvedSourceAuthMaterial => {
  const acc = {
    headers: {} as Record<string, string>,
    queryParams: {} as Record<string, string>,
    cookies: {} as Record<string, string>,
    bodyValues: {} as Record<string, string>,
  };

  for (const placement of placements) {
    mergePlacement(acc, placement);
  }

  return {
    placements,
    headers: acc.headers,
    queryParams: acc.queryParams,
    cookies: acc.cookies,
    bodyValues: acc.bodyValues,
    expiresAt: input.expiresAt ?? null,
    refreshAfter: input.refreshAfter ?? null,
  };
};

const resolvePlacementParts = (input: {
  parts: ReadonlyArray<RequestPlacementPart>;
  resolveSecretMaterial: ResolveSecretMaterial;
  context?: SecretMaterialResolveContext;
}): Effect.Effect<string, Error, never> =>
  Effect.map(
    Effect.forEach(input.parts, (part) =>
      part.kind === "literal"
        ? Effect.succeed(part.value)
        : input.resolveSecretMaterial({
            ref: part.ref,
            context: input.context,
          }), { discard: false }),
    (values) => values.join(""),
  );

export const authArtifactFromSourceAuth = (input: {
  source: Source;
  auth: SourceAuth;
  slot: CredentialSlot;
  actorScopeId?: ScopeId | null;
  existingAuthArtifactId?: AuthArtifact["id"] | null;
}): AuthArtifact | null => {
  if (input.auth.kind === "none") {
    return null;
  }

  const id = input.existingAuthArtifactId ?? `auth_art_${crypto.randomUUID()}` as AuthArtifact["id"];
  const grantSetJson =
    input.auth.kind === "oauth2_authorized_user"
      ? encodeAuthGrantSetJson(input.auth.grantSet)
      : null;

  if (input.auth.kind === "bearer") {
    return {
      id,
      scopeId: input.source.scopeId,
      sourceId: input.source.id,
      actorScopeId: input.actorScopeId ?? null,
      slot: input.slot,
      artifactKind: StaticBearerAuthArtifactKind,
      configJson: encodeStaticBearerAuthArtifactConfig({
        headerName: input.auth.headerName,
        prefix: input.auth.prefix,
        token: input.auth.token,
      }),
      grantSetJson,
      createdAt: input.source.createdAt,
      updatedAt: input.source.updatedAt,
    };
  }

  if (input.auth.kind === "oauth2_authorized_user") {
    return {
      id,
      scopeId: input.source.scopeId,
      sourceId: input.source.id,
      actorScopeId: input.actorScopeId ?? null,
      slot: input.slot,
      artifactKind: RefreshableOAuth2AuthorizedUserAuthArtifactKind,
      configJson: encodeRefreshableOAuth2AuthorizedUserAuthArtifactConfig({
        headerName: input.auth.headerName,
        prefix: input.auth.prefix,
        tokenEndpoint: input.auth.tokenEndpoint,
        clientId: input.auth.clientId,
        clientAuthentication: input.auth.clientAuthentication,
        clientSecret: input.auth.clientSecret,
        refreshToken: input.auth.refreshToken,
      }),
      grantSetJson,
      createdAt: input.source.createdAt,
      updatedAt: input.source.updatedAt,
    };
  }

  if (input.auth.kind === "provider_grant_ref") {
    return {
      id,
      scopeId: input.source.scopeId,
      sourceId: input.source.id,
      actorScopeId: input.actorScopeId ?? null,
      slot: input.slot,
      artifactKind: ProviderGrantRefAuthArtifactKind,
      configJson: encodeProviderGrantRefAuthArtifactConfig({
        grantId: input.auth.grantId,
        providerKey: input.auth.providerKey,
        requiredScopes: [...input.auth.requiredScopes],
        headerName: input.auth.headerName,
        prefix: input.auth.prefix,
      }),
      grantSetJson,
      createdAt: input.source.createdAt,
      updatedAt: input.source.updatedAt,
    };
  }

  if (input.auth.kind === "mcp_oauth") {
    return {
      id,
      scopeId: input.source.scopeId,
      sourceId: input.source.id,
      actorScopeId: input.actorScopeId ?? null,
      slot: input.slot,
      artifactKind: McpOAuthAuthArtifactKind,
      configJson: encodeMcpOAuthAuthArtifactConfig({
        redirectUri: input.auth.redirectUri,
        accessToken: input.auth.accessToken,
        refreshToken: input.auth.refreshToken,
        tokenType: input.auth.tokenType,
        expiresIn: input.auth.expiresIn,
        scope: input.auth.scope,
        resourceMetadataUrl: input.auth.resourceMetadataUrl,
        authorizationServerUrl: input.auth.authorizationServerUrl,
        resourceMetadataJson: input.auth.resourceMetadataJson,
        authorizationServerMetadataJson: input.auth.authorizationServerMetadataJson,
        clientInformationJson: input.auth.clientInformationJson,
      }),
      grantSetJson,
      createdAt: input.source.createdAt,
      updatedAt: input.source.updatedAt,
    };
  }

  return {
    id,
    scopeId: input.source.scopeId,
    sourceId: input.source.id,
    actorScopeId: input.actorScopeId ?? null,
    slot: input.slot,
    artifactKind: StaticOAuth2AuthArtifactKind,
    configJson: encodeStaticOAuth2AuthArtifactConfig({
      headerName: input.auth.headerName,
      prefix: input.auth.prefix,
      accessToken: input.auth.accessToken,
      refreshToken: input.auth.refreshToken,
    }),
    grantSetJson,
    createdAt: input.source.createdAt,
    updatedAt: input.source.updatedAt,
  };
};

export const sourceAuthFromAuthArtifact = (artifact: AuthArtifact | null): SourceAuth => {
  if (artifact === null) {
    return { kind: "none" };
  }

  const providerGrantRefConfig = decodeProviderGrantRefAuthArtifactConfig(artifact);
  if (providerGrantRefConfig !== null) {
    return {
      kind: "provider_grant_ref",
      grantId: providerGrantRefConfig.grantId,
      providerKey: providerGrantRefConfig.providerKey,
      requiredScopes: [...providerGrantRefConfig.requiredScopes],
      headerName: providerGrantRefConfig.headerName,
      prefix: providerGrantRefConfig.prefix,
    };
  }

  const mcpOAuthConfig = decodeMcpOAuthAuthArtifactConfig(artifact);
  if (mcpOAuthConfig !== null) {
    return {
      kind: "mcp_oauth",
      redirectUri: mcpOAuthConfig.redirectUri,
      accessToken: mcpOAuthConfig.accessToken,
      refreshToken: mcpOAuthConfig.refreshToken,
      tokenType: mcpOAuthConfig.tokenType,
      expiresIn: mcpOAuthConfig.expiresIn,
      scope: mcpOAuthConfig.scope,
      resourceMetadataUrl: mcpOAuthConfig.resourceMetadataUrl,
      authorizationServerUrl: mcpOAuthConfig.authorizationServerUrl,
      resourceMetadataJson: mcpOAuthConfig.resourceMetadataJson,
      authorizationServerMetadataJson: mcpOAuthConfig.authorizationServerMetadataJson,
      clientInformationJson: mcpOAuthConfig.clientInformationJson,
    };
  }

  const decoded = decodeBuiltInAuthArtifactConfig(artifact);
  if (decoded === null) {
    return { kind: "none" };
  }

  switch (decoded.artifactKind) {
    case StaticBearerAuthArtifactKind:
      return {
        kind: "bearer",
        headerName: decoded.config.headerName,
        prefix: decoded.config.prefix,
        token: decoded.config.token,
      };
    case StaticOAuth2AuthArtifactKind:
      return {
        kind: "oauth2",
        headerName: decoded.config.headerName,
        prefix: decoded.config.prefix,
        accessToken: decoded.config.accessToken,
        refreshToken: decoded.config.refreshToken,
      };
    case StaticPlacementsAuthArtifactKind:
      return { kind: "none" };
    case RefreshableOAuth2AuthorizedUserAuthArtifactKind:
      return {
        kind: "oauth2_authorized_user",
        headerName: decoded.config.headerName,
        prefix: decoded.config.prefix,
        tokenEndpoint: decoded.config.tokenEndpoint,
        clientId: decoded.config.clientId,
        clientAuthentication: decoded.config.clientAuthentication,
        clientSecret: decoded.config.clientSecret,
        refreshToken: decoded.config.refreshToken,
        grantSet: decodeAuthGrantSet(artifact.grantSetJson),
      };
  }
};

export const authArtifactGrantSet = (artifact: Pick<AuthArtifact, "grantSetJson">): ReadonlyArray<string> | null =>
  decodeAuthGrantSet(artifact.grantSetJson);

export const authArtifactSecretMaterialRefs = (
  artifact: Pick<AuthArtifact, "artifactKind" | "configJson">,
): ReadonlyArray<SecretRef> => authArtifactSecretRefs(artifact);

export const encodeStaticPlacementsArtifactConfig = (placements: ReadonlyArray<{
  location: "header" | "query" | "cookie" | "body";
  name?: string;
  path?: string;
  parts: ReadonlyArray<RequestPlacementPart>;
}>): string =>
  encodeStaticPlacementsAuthArtifactConfig({
    placements: placements.map((placement) =>
      placement.location === "body"
        ? {
            location: "body" as const,
            path: placement.path ?? "",
            parts: [...placement.parts],
          }
        : {
            location: placement.location,
            name: placement.name ?? "",
            parts: [...placement.parts],
          }),
  });

export const encodeAuthGrantSetJson = (grantSet: ReadonlyArray<string> | null): string | null =>
  grantSet === null ? null : encodeAuthGrantSet([...grantSet]);

export const resolveAuthArtifactMaterial = (input: {
  artifact: AuthArtifact | null;
  lease?: {
    placementsTemplateJson: string;
    expiresAt: number | null;
    refreshAfter: number | null;
  } | null;
  resolveSecretMaterial: ResolveSecretMaterial;
  context?: SecretMaterialResolveContext;
}): Effect.Effect<ResolvedSourceAuthMaterial, Error, never> =>
  Effect.gen(function* () {
    if (input.artifact === null) {
      return emptyResolvedAuthMaterial;
    }

    const decoded = decodeBuiltInAuthArtifactConfig(input.artifact);
    if (decoded !== null) {
      switch (decoded.artifactKind) {
        case StaticBearerAuthArtifactKind: {
          const token = yield* input.resolveSecretMaterial({
            ref: decoded.config.token,
            context: input.context,
          });

          return summarizeResolvedPlacements([
            {
              location: "header",
              name: decoded.config.headerName,
              value: `${decoded.config.prefix}${token}`,
            },
          ]);
        }
        case StaticOAuth2AuthArtifactKind: {
          const accessToken = yield* input.resolveSecretMaterial({
            ref: decoded.config.accessToken,
            context: input.context,
          });

          return summarizeResolvedPlacements([
            {
              location: "header",
              name: decoded.config.headerName,
              value: `${decoded.config.prefix}${accessToken}`,
            },
          ]);
        }
        case StaticPlacementsAuthArtifactKind: {
          const placements = yield* Effect.forEach(decoded.config.placements, (placement) =>
            Effect.map(
              resolvePlacementParts({
                parts: placement.parts,
                resolveSecretMaterial: input.resolveSecretMaterial,
                context: input.context,
              }),
              (value): RequestPlacement =>
                placement.location === "body"
                  ? {
                      location: "body",
                      path: placement.path,
                      value,
                    }
                  : {
                      location: placement.location,
                      name: placement.name,
                      value,
                    },
            ), { discard: false });

          return summarizeResolvedPlacements(placements);
        }
        case RefreshableOAuth2AuthorizedUserAuthArtifactKind:
          break;
      }
    }

    const providerGrantRefConfig = decodeProviderGrantRefAuthArtifactConfig(input.artifact);
    if (providerGrantRefConfig !== null) {
      if (input.lease === null || input.lease === undefined) {
        return yield* runtimeEffectError("auth/auth-artifacts", `Provider grant auth artifact ${input.artifact.id} requires a lease`);
      }
    }

    const mcpOAuthConfig = decodeMcpOAuthAuthArtifactConfig(input.artifact);
    if (mcpOAuthConfig !== null) {
      return {
        ...emptyResolvedAuthMaterial,
      };
    }

    if (input.lease === null || input.lease === undefined) {
      return yield* runtimeEffectError("auth/auth-artifacts", `Unsupported auth artifact kind: ${input.artifact.artifactKind}`);
    }

    const templatesEither = decodeRequestPlacementTemplates(
      input.lease.placementsTemplateJson,
    );
    if (Either.isLeft(templatesEither)) {
      return yield* runtimeEffectError("auth/auth-artifacts", 
        `Invalid auth lease placements for artifact ${input.artifact.id}`,
      );
    }

    const placements = yield* Effect.forEach(templatesEither.right, (placement) =>
      Effect.map(
        resolvePlacementParts({
          parts: placement.parts,
          resolveSecretMaterial: input.resolveSecretMaterial,
          context: input.context,
        }),
        (value): RequestPlacement =>
          placement.location === "body"
            ? {
                location: "body",
                path: placement.path,
                value,
              }
            : {
                location: placement.location,
                name: placement.name,
                value,
              },
      ), { discard: false });

    return summarizeResolvedPlacements(placements, {
      expiresAt: input.lease.expiresAt,
      refreshAfter: input.lease.refreshAfter,
    });
  });
