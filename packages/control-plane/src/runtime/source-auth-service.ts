import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  createSdkMcpConnector,
  discoverMcpToolsFromConnector,
  type McpDiscoveryElicitationContext,
} from "@executor-v3/codemode-mcp";
import {
  SqlControlPlaneRowsService,
  type SqlControlPlaneRows,
} from "#persistence";
import {
  ExecutionIdSchema,
  type SecretMaterialPurpose,
  Source,
  SourceAuthSession,
  SourceAuthSessionIdSchema,
  SourceIdSchema,
  SourceSchema,
  type SecretRef,
  type WorkspaceId,
} from "#schema";
import * as Context from "effect/Context";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  LiveExecutionManagerService,
  type LiveExecutionManager,
} from "./live-execution";
import {
  createSourceFromPayload,
  updateSourceFromPayload,
} from "./source-definitions";
import {
  createDefaultSecretMaterialResolver,
  createDefaultSecretMaterialStorer,
  type ResolveSecretMaterial,
  type StoreSecretMaterial,
} from "./secret-material-providers";
import {
  persistMcpToolArtifactsFromManifest,
  syncSourceToolArtifacts,
} from "./tool-artifacts";
import {
  loadSourceById,
  loadSourcesInWorkspace,
  persistSource,
} from "./source-store";

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const defaultSourceNameFromEndpoint = (endpoint: string): string => {
  const url = new URL(endpoint);
  return url.hostname;
};

const defaultNamespaceFromName = (name: string): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

const serializeJson = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
};

const decodeJson = <A>(input: {
  value: string | null;
  fallback: A;
}): A => {
  if (input.value === null) {
    return input.fallback;
  }

  try {
    return JSON.parse(input.value) as A;
  } catch {
    return input.fallback;
  }
};

const resolveSourceCredentialOauthCompleteUrl = (input: {
  baseUrl: string;
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}): string =>
  new URL(
    `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/sources/${encodeURIComponent(input.sourceId)}/credentials/oauth/complete`,
    input.baseUrl,
  ).toString();

const normalizeEndpoint = (endpoint: string): string => {
  const url = new URL(endpoint.trim());
  return url.toString();
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));



const probeMcpSourceWithoutAuth = (
  source: Source,
  mcpDiscoveryElicitation?: McpDiscoveryElicitationContext,
) =>
  Effect.gen(function* () {
    if (source.kind !== "mcp") {
      return yield* Effect.fail(new Error(`Expected MCP source, received ${source.kind}`));
    }

    const connector = yield* Effect.try({
      try: () =>
        createSdkMcpConnector({
          endpoint: source.endpoint,
          transport: source.transport ?? undefined,
          queryParams: source.queryParams ?? undefined,
          headers: source.headers ?? undefined,
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    return yield* discoverMcpToolsFromConnector({
      connect: connector,
      namespace: source.namespace ?? defaultNamespaceFromName(source.name),
      sourceKey: source.id,
      mcpDiscoveryElicitation,
    });
  });

const createSourceClientMetadata = (redirectUrl: string) => ({
  redirect_uris: [redirectUrl],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  client_name: "Executor Local",
});

type PendingOAuthStart = {
  authorizationUrl: string;
  codeVerifier: string;
  resourceMetadataUrl: string | null;
  authorizationServerUrl: string | null;
  resourceMetadataJson: string | null;
  authorizationServerMetadataJson: string | null;
  clientInformationJson: string | null;
};

const startOAuthAuthorization = (input: {
  endpoint: string;
  redirectUrl: string;
  state: string;
}): Effect.Effect<PendingOAuthStart, Error, never> =>
  Effect.gen(function* () {
    const captured: {
      authorizationUrl?: URL;
      codeVerifier?: string;
      discoveryState?: OAuthDiscoveryState;
      clientInformation?: OAuthClientInformationMixed;
    } = {};

    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return input.redirectUrl;
      },
      get clientMetadata() {
        return createSourceClientMetadata(input.redirectUrl);
      },
      state: () => input.state,
      clientInformation: () => captured.clientInformation,
      saveClientInformation: (clientInformation) => {
        captured.clientInformation = clientInformation;
      },
      tokens: () => undefined,
      saveTokens: () => undefined,
      redirectToAuthorization: (authorizationUrl) => {
        captured.authorizationUrl = authorizationUrl;
      },
      saveCodeVerifier: (codeVerifier) => {
        captured.codeVerifier = codeVerifier;
      },
      codeVerifier: () => {
        if (!captured.codeVerifier) {
          throw new Error("OAuth code verifier was not captured");
        }

        return captured.codeVerifier;
      },
      saveDiscoveryState: (state) => {
        captured.discoveryState = state;
      },
      discoveryState: () => captured.discoveryState,
    };

    const result = yield* Effect.tryPromise({
      try: () =>
        auth(provider, {
          serverUrl: input.endpoint,
        }),
      catch: toError,
    });

    if (result !== "REDIRECT" || !captured.authorizationUrl || !captured.codeVerifier) {
      return yield* Effect.fail(
        new Error("OAuth flow did not produce an authorization redirect"),
      );
    }

    return {
      authorizationUrl: captured.authorizationUrl.toString(),
      codeVerifier: captured.codeVerifier,
      resourceMetadataUrl: captured.discoveryState?.resourceMetadataUrl ?? null,
      authorizationServerUrl: captured.discoveryState?.authorizationServerUrl ?? null,
      resourceMetadataJson: serializeJson(captured.discoveryState?.resourceMetadata),
      authorizationServerMetadataJson: serializeJson(
        captured.discoveryState?.authorizationServerMetadata,
      ),
      clientInformationJson: serializeJson(captured.clientInformation),
    } satisfies PendingOAuthStart;
  });

type ExchangedTokens = {
  tokens: OAuthTokens;
  resourceMetadataUrl: string | null;
  authorizationServerUrl: string | null;
  resourceMetadataJson: string | null;
  authorizationServerMetadataJson: string | null;
};

const exchangeOAuthAuthorizationCode = (input: {
  session: SourceAuthSession;
  code: string;
}): Effect.Effect<ExchangedTokens, Error, never> =>
  Effect.gen(function* () {
    const captured: {
      tokens?: OAuthTokens;
      discoveryState?: OAuthDiscoveryState;
      clientInformation?: OAuthClientInformationMixed;
    } = {
      discoveryState: {
        authorizationServerUrl: input.session.authorizationServerUrl ?? new URL("/", input.session.endpoint).toString(),
        resourceMetadataUrl: input.session.resourceMetadataUrl ?? undefined,
        resourceMetadata: decodeJson({
          value: input.session.resourceMetadataJson,
          fallback: undefined,
        }),
        authorizationServerMetadata: decodeJson({
          value: input.session.authorizationServerMetadataJson,
          fallback: undefined,
        }),
      },
      clientInformation: decodeJson<OAuthClientInformationMixed | undefined>({
        value: input.session.clientInformationJson,
        fallback: undefined,
      }),
    };

    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return input.session.redirectUri;
      },
      get clientMetadata() {
        return createSourceClientMetadata(input.session.redirectUri);
      },
      clientInformation: () => captured.clientInformation,
      saveClientInformation: (clientInformation) => {
        captured.clientInformation = clientInformation;
      },
      tokens: () => undefined,
      saveTokens: (tokens) => {
        captured.tokens = tokens;
      },
      redirectToAuthorization: () => {
        throw new Error("Unexpected redirect while completing source credential setup");
      },
      saveCodeVerifier: () => undefined,
      codeVerifier: () => {
        if (!input.session.codeVerifier) {
          throw new Error("OAuth session is missing the PKCE code verifier");
        }

        return input.session.codeVerifier;
      },
      saveDiscoveryState: (state) => {
        captured.discoveryState = state;
      },
      discoveryState: () => captured.discoveryState,
    };

    const result = yield* Effect.tryPromise({
      try: () =>
        auth(provider, {
          serverUrl: input.session.endpoint,
          authorizationCode: input.code,
        }),
      catch: toError,
    });

    if (result !== "AUTHORIZED" || !captured.tokens) {
      return yield* Effect.fail(new Error("OAuth redirect did not complete source credential setup"));
    }

    return {
      tokens: captured.tokens,
      resourceMetadataUrl: captured.discoveryState?.resourceMetadataUrl ?? null,
      authorizationServerUrl: captured.discoveryState?.authorizationServerUrl ?? null,
      resourceMetadataJson: serializeJson(captured.discoveryState?.resourceMetadata),
      authorizationServerMetadataJson: serializeJson(
        captured.discoveryState?.authorizationServerMetadata,
      ),
    } satisfies ExchangedTokens;
  });

export const createTerminalSourceAuthSessionPatch = (input: {
  status: Extract<SourceAuthSession["status"], "completed" | "failed" | "cancelled">;
  now: number;
  errorText: string | null;
  resourceMetadataUrl?: string | null;
  authorizationServerUrl?: string | null;
  resourceMetadataJson?: string | null;
  authorizationServerMetadataJson?: string | null;
}) => ({
  status: input.status,
  errorText: input.errorText,
  completedAt: input.now,
  updatedAt: input.now,
  codeVerifier: null,
  authorizationUrl: null,
  clientInformationJson: null,
  resourceMetadataUrl: input.resourceMetadataUrl ?? null,
  authorizationServerUrl: input.authorizationServerUrl ?? null,
  resourceMetadataJson: input.resourceMetadataJson ?? null,
  authorizationServerMetadataJson: input.authorizationServerMetadataJson ?? null,
}) satisfies Partial<SourceAuthSession>;


const completeLiveInteraction = (input: {
  liveExecutionManager: LiveExecutionManager;
  session: SourceAuthSession;
  response: {
    action: "accept" | "cancel";
    reason?: string;
  };
}) =>
  Effect.gen(function* () {
    if (input.session.executionId === null) {
      return;
    }

    yield* input.liveExecutionManager.resolveInteraction({
      executionId: input.session.executionId,
      response:
        input.response.action === "accept"
          ? { action: "accept" }
          : {
              action: "cancel",
              ...(input.response.reason
                ? {
                    content: {
                      reason: input.response.reason,
                    },
                  }
                : {}),
            },
    });
  });

const updateSourceStatus = (rows: SqlControlPlaneRows, source: Source, input: {
  status: Source["status"];
  lastError?: string | null;
  auth?: Source["auth"];
}) =>
  Effect.gen(function* () {
    const latest = yield* loadSourceById(rows, {
      workspaceId: source.workspaceId,
      sourceId: source.id,
    });

    return yield* persistSource(rows, {
      ...latest,
      status: input.status,
      lastError: input.lastError ?? null,
      auth: input.auth ?? latest.auth,
      updatedAt: Date.now(),
    });
  });

export type ExecutorSourceAddResult =
  | {
      kind: "connected";
      source: Source;
    }
  | {
      kind: "credential_required";
      source: Source;
    }
  | {
      kind: "oauth_required";
      source: Source;
      sessionId: SourceAuthSession["id"];
      authorizationUrl: string;
    };

export type ExecutorOpenApiSourceAuthInput =
  | {
      kind: "none";
    }
  | {
      kind: "bearer";
      headerName?: string | null;
      prefix?: string | null;
      token?: string | null;
      tokenRef?: SecretRef | null;
    };

export type ExecutorAddSourceInput =
  | {
      kind?: "mcp";
      workspaceId: WorkspaceId;
      executionId: SourceAuthSession["executionId"];
      interactionId: SourceAuthSession["interactionId"];
      endpoint: string;
      name?: string | null;
      namespace?: string | null;
    }
  | {
      kind: "openapi";
      workspaceId: WorkspaceId;
      executionId: SourceAuthSession["executionId"];
      interactionId: SourceAuthSession["interactionId"];
      endpoint: string;
      specUrl: string;
      name?: string | null;
      namespace?: string | null;
      auth?: ExecutorOpenApiSourceAuthInput | null;
    };

export type ConnectMcpSourceInput = {
  workspaceId: WorkspaceId;
  sourceId?: Source["id"] | null;
  endpoint: string;
  name?: string | null;
  namespace?: string | null;
  enabled?: boolean;
  transport?: Source["transport"];
  queryParams?: Source["queryParams"];
  headers?: Source["headers"];
};

export type McpSourceConnectResult = Extract<ExecutorSourceAddResult, {
  kind: "connected" | "oauth_required";
}>;

export const shouldPromptForOpenApiCredentialSetup = (input: {
  existing?: Source;
  auth?: ExecutorOpenApiSourceAuthInput | null;
}): boolean => {
  if (input.auth !== undefined) {
    return false;
  }

  return !(input.existing?.kind === "openapi" && input.existing.auth.kind !== "none");
};

const materializeExecutorOpenApiAuth = (input: {
  existing?: Source;
  auth?: ExecutorOpenApiSourceAuthInput | null;
  storeSecretMaterial: StoreSecretMaterial;
}): Effect.Effect<Source["auth"], Error, never> =>
  Effect.gen(function* () {
    if (input.auth === undefined && input.existing?.kind === "openapi") {
      return input.existing.auth;
    }

    const auth = input.auth ?? { kind: "none" } satisfies ExecutorOpenApiSourceAuthInput;
    if (auth.kind === "none") {
      return { kind: "none" } satisfies Source["auth"];
    }

    const headerName = trimOrNull(auth.headerName) ?? "Authorization";
    const prefix = auth.prefix ?? "Bearer ";
    const token = trimOrNull(auth.token);
    const tokenRefInput = auth.tokenRef ?? null;

    if (
      token === null
      && tokenRefInput === null
      && input.existing?.kind === "openapi"
      && input.existing.auth.kind === "bearer"
    ) {
      return input.existing.auth;
    }

    if (token === null && tokenRefInput === null) {
      return yield* Effect.fail(
        new Error("Bearer auth requires token or tokenRef"),
      );
    }

    const tokenRef = token !== null
      ? yield* input.storeSecretMaterial({
          purpose: "auth_material",
          value: token,
        })
      : (() => {
          const providerId = trimOrNull(tokenRefInput?.providerId);
          const handle = trimOrNull(tokenRefInput?.handle);
          if (providerId === null || handle === null) {
            return null;
          }

          return {
            providerId,
            handle,
          } satisfies SecretRef;
        })();

    if (tokenRef === null) {
      return yield* Effect.fail(
        new Error("Bearer auth tokenRef must include providerId and handle"),
      );
    }

    return {
      kind: "bearer",
      headerName,
      prefix,
      token: tokenRef,
    } satisfies Source["auth"];
  });

const connectMcpSourceInternal = (input: {
  rows: SqlControlPlaneRows;
  getLocalServerBaseUrl?: () => string | undefined;
  workspaceId: WorkspaceId;
  sourceId?: Source["id"] | null;
  executionId?: SourceAuthSession["executionId"];
  interactionId?: SourceAuthSession["interactionId"];
  endpoint: string;
  name?: string | null;
  namespace?: string | null;
  enabled?: boolean;
  transport?: Source["transport"];
  queryParams?: Source["queryParams"];
  headers?: Source["headers"];
  mcpDiscoveryElicitation?: McpDiscoveryElicitationContext;
  resolveSecretMaterial: ResolveSecretMaterial;
}): Effect.Effect<McpSourceConnectResult, Error, never> =>
  Effect.gen(function* () {
    const normalizedEndpoint = normalizeEndpoint(input.endpoint);
    const existing = yield* (
      input.sourceId
        ? loadSourceById(input.rows, {
            workspaceId: input.workspaceId,
            sourceId: input.sourceId,
          }).pipe(
            Effect.flatMap((source) =>
              source.kind === "mcp"
                ? Effect.succeed(source)
                : Effect.fail(new Error(`Expected MCP source, received ${source.kind}`)),
            ),
          )
        : loadSourcesInWorkspace(input.rows, input.workspaceId).pipe(
            Effect.map((sources) =>
              sources.find(
                (source) =>
                  source.kind === "mcp" && normalizeEndpoint(source.endpoint) === normalizedEndpoint,
              ),
            ),
          )
    );

    const chosenName =
      trimOrNull(input.name) ?? existing?.name ?? defaultSourceNameFromEndpoint(normalizedEndpoint);
    const chosenNamespace =
      trimOrNull(input.namespace)
      ?? existing?.namespace
      ?? defaultNamespaceFromName(chosenName);
    const chosenEnabled = input.enabled ?? existing?.enabled ?? true;
    const chosenTransport = input.transport ?? existing?.transport ?? "auto";
    const chosenQueryParams =
      input.queryParams !== undefined ? input.queryParams : (existing?.queryParams ?? null);
    const chosenHeaders =
      input.headers !== undefined ? input.headers : (existing?.headers ?? null);
    const now = Date.now();

    const draftSource = existing
      ? yield* updateSourceFromPayload({
          source: existing,
          payload: {
            name: chosenName,
            endpoint: normalizedEndpoint,
            namespace: chosenNamespace,
            kind: "mcp",
            status: "probing",
            enabled: chosenEnabled,
            transport: chosenTransport,
            queryParams: chosenQueryParams,
            headers: chosenHeaders,
            auth: { kind: "none" },
            lastError: null,
          },
          now,
        })
      : yield* createSourceFromPayload({
          workspaceId: input.workspaceId,
          sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
          payload: {
            name: chosenName,
            kind: "mcp",
            endpoint: normalizedEndpoint,
            namespace: chosenNamespace,
            status: "probing",
            enabled: chosenEnabled,
            transport: chosenTransport,
            queryParams: chosenQueryParams,
            headers: chosenHeaders,
            auth: { kind: "none" },
          },
          now,
        });

    const persistedDraft = yield* persistSource(input.rows, draftSource);
    yield* syncSourceToolArtifacts({
      rows: input.rows,
      source: persistedDraft,
      resolveSecretMaterial: input.resolveSecretMaterial,
    });

    const discovered = yield* Effect.either(
      probeMcpSourceWithoutAuth(
        persistedDraft,
        input.mcpDiscoveryElicitation,
      ),
    );

    const connectedResult = yield* Either.match(discovered, {
      onLeft: () => Effect.succeed(null),
      onRight: (result) =>
        Effect.gen(function* () {
          const connected = yield* updateSourceStatus(input.rows, persistedDraft, {
            status: "connected",
            lastError: null,
            auth: { kind: "none" },
          });
          const indexed = yield* Effect.either(
            persistMcpToolArtifactsFromManifest({
              rows: input.rows,
              source: connected,
              manifestEntries: result.manifest.tools,
            }),
          );

          return yield* Either.match(indexed, {
            onLeft: (error) =>
              updateSourceStatus(input.rows, connected, {
                status: "error",
                lastError: error.message,
              }).pipe(
                Effect.zipRight(Effect.fail(error)),
              ),
            onRight: () =>
              Effect.succeed({
                kind: "connected",
                source: connected,
              } satisfies McpSourceConnectResult),
          });
        }),
    });

    if (connectedResult) {
      return connectedResult;
    }

    const localServerBaseUrl = input.getLocalServerBaseUrl?.();
    if (!localServerBaseUrl) {
      return yield* Effect.fail(
        new Error("Local executor server base URL is unavailable for source credential setup"),
      );
    }

    const sessionId = SourceAuthSessionIdSchema.make(`src_auth_${crypto.randomUUID()}`);
    const state = crypto.randomUUID();
    const redirectUrl = resolveSourceCredentialOauthCompleteUrl({
      baseUrl: localServerBaseUrl,
      workspaceId: input.workspaceId,
      sourceId: persistedDraft.id,
    });
    const oauthStart = yield* startOAuthAuthorization({
      endpoint: normalizedEndpoint,
      redirectUrl,
      state,
    });

    const authRequiredSource = yield* updateSourceStatus(input.rows, persistedDraft, {
      status: "auth_required",
      lastError: null,
    });

    const sessionNow = Date.now();
    yield* input.rows.sourceAuthSessions.upsert({
      id: sessionId,
      workspaceId: input.workspaceId,
      sourceId: authRequiredSource.id,
      executionId: input.executionId ?? null,
      interactionId: input.interactionId ?? null,
      strategy: "oauth2_authorization_code",
      status: "pending",
      endpoint: normalizedEndpoint,
      state,
      redirectUri: redirectUrl,
      scope: null,
      resourceMetadataUrl: oauthStart.resourceMetadataUrl,
      authorizationServerUrl: oauthStart.authorizationServerUrl,
      resourceMetadataJson: oauthStart.resourceMetadataJson,
      authorizationServerMetadataJson: oauthStart.authorizationServerMetadataJson,
      clientInformationJson: oauthStart.clientInformationJson,
      codeVerifier: oauthStart.codeVerifier,
      authorizationUrl: oauthStart.authorizationUrl,
      errorText: null,
      completedAt: null,
      createdAt: sessionNow,
      updatedAt: sessionNow,
    });

    return {
      kind: "oauth_required",
      source: authRequiredSource,
      sessionId,
      authorizationUrl: oauthStart.authorizationUrl,
    } satisfies McpSourceConnectResult;
  });

type RuntimeSourceAuthServiceShape = {
  getSourceById: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
  }) => Effect.Effect<Source, Error, never>;
  getLocalServerBaseUrl: () => string | null;
  storeSecretMaterial: (input: {
    purpose: SecretMaterialPurpose;
    value: string;
  }) => Effect.Effect<SecretRef, Error, never>;
  addExecutorSource: (
    input: ExecutorAddSourceInput,
    options?: {
      mcpDiscoveryElicitation?: McpDiscoveryElicitationContext;
    },
  ) => Effect.Effect<ExecutorSourceAddResult, Error, never>;
  connectMcpSource: (
    input: ConnectMcpSourceInput,
  ) => Effect.Effect<McpSourceConnectResult, Error, never>;
  completeSourceCredentialSetup: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
    state: string;
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  }) => Effect.Effect<Source, Error, never>;
};

export const createRuntimeSourceAuthService = (input: {
  rows: SqlControlPlaneRows;
  liveExecutionManager: LiveExecutionManager;
  getLocalServerBaseUrl?: () => string | undefined;
}) => {
  const resolveSecretMaterial = createDefaultSecretMaterialResolver({
    rows: input.rows,
  });
  const storeSecretMaterial = createDefaultSecretMaterialStorer({
    rows: input.rows,
  });

  return {
  getLocalServerBaseUrl: () => input.getLocalServerBaseUrl?.() ?? null,

  storeSecretMaterial: ({ purpose, value }) =>
    storeSecretMaterial({
      purpose,
      value,
    }),

  getSourceById: ({ workspaceId, sourceId }) =>
    loadSourceById(input.rows, {
      workspaceId,
      sourceId,
    }),

  addExecutorSource: (sourceInput, options) =>
    sourceInput.kind === "openapi"
      ? Effect.gen(function* () {
          const normalizedEndpoint = normalizeEndpoint(sourceInput.endpoint);
          const normalizedSpecUrl = normalizeEndpoint(sourceInput.specUrl);
          const existingSources = yield* loadSourcesInWorkspace(
            input.rows,
            sourceInput.workspaceId,
          );
          const existing = existingSources.find(
            (source) =>
              source.kind === "openapi"
              && normalizeEndpoint(source.endpoint) === normalizedEndpoint
              && trimOrNull(source.specUrl) === normalizedSpecUrl,
          );

          const chosenName =
            trimOrNull(sourceInput.name)
            ?? existing?.name
            ?? defaultSourceNameFromEndpoint(normalizedEndpoint);
          const chosenNamespace =
            trimOrNull(sourceInput.namespace)
            ?? existing?.namespace
            ?? defaultNamespaceFromName(chosenName);
          const now = Date.now();

          if (shouldPromptForOpenApiCredentialSetup({
            existing,
            auth: sourceInput.auth,
          })) {
            const draftSource = existing
              ? yield* updateSourceFromPayload({
                  source: existing,
                  payload: {
                    name: chosenName,
                    endpoint: normalizedEndpoint,
                    namespace: chosenNamespace,
                    kind: "openapi",
                    status: "auth_required",
                    enabled: true,
                    specUrl: normalizedSpecUrl,
                    auth: { kind: "none" },
                    lastError: null,
                  },
                  now,
                })
              : yield* createSourceFromPayload({
                  workspaceId: sourceInput.workspaceId,
                  sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
                  payload: {
                    name: chosenName,
                    kind: "openapi",
                    endpoint: normalizedEndpoint,
                    namespace: chosenNamespace,
                    status: "auth_required",
                    enabled: true,
                    specUrl: normalizedSpecUrl,
                    auth: { kind: "none" },
                  },
                  now,
                });

            const persistedDraft = yield* persistSource(input.rows, draftSource);
            return {
              kind: "credential_required",
              source: persistedDraft,
            } satisfies ExecutorSourceAddResult;
          }

          const auth = yield* materializeExecutorOpenApiAuth({
            existing,
            auth: sourceInput.auth,
            storeSecretMaterial,
          });

          const draftSource = existing
            ? yield* updateSourceFromPayload({
                source: existing,
                payload: {
                  name: chosenName,
                  endpoint: normalizedEndpoint,
                  namespace: chosenNamespace,
                  kind: "openapi",
                  status: "probing",
                  enabled: true,
                  specUrl: normalizedSpecUrl,
                  auth,
                  lastError: null,
                },
                now,
              })
            : yield* createSourceFromPayload({
                workspaceId: sourceInput.workspaceId,
                sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
                payload: {
                  name: chosenName,
                  kind: "openapi",
                  endpoint: normalizedEndpoint,
                  namespace: chosenNamespace,
                  status: "probing",
                  enabled: true,
                  specUrl: normalizedSpecUrl,
                  auth,
                },
                now,
              });

          const persistedDraft = yield* persistSource(input.rows, draftSource);
          const synced = yield* Effect.either(
            syncSourceToolArtifacts({
              rows: input.rows,
              source: {
                ...persistedDraft,
                status: "connected",
              },
              resolveSecretMaterial,
            }),
          );

          return yield* Either.match(synced, {
            onLeft: (error) =>
              updateSourceStatus(input.rows, persistedDraft, {
                status: "error",
                lastError: error.message,
              }).pipe(
                Effect.zipRight(Effect.fail(error)),
              ),
            onRight: () =>
              updateSourceStatus(input.rows, persistedDraft, {
                status: "connected",
                lastError: null,
              }).pipe(
                Effect.map((source) =>
                  ({
                    kind: "connected",
                    source,
                  } satisfies ExecutorSourceAddResult)
                ),
              ),
          });
        })
      : connectMcpSourceInternal({
          rows: input.rows,
          getLocalServerBaseUrl: input.getLocalServerBaseUrl,
          workspaceId: sourceInput.workspaceId,
          executionId: sourceInput.executionId,
          interactionId: sourceInput.interactionId,
          endpoint: sourceInput.endpoint,
          name: sourceInput.name,
          namespace: sourceInput.namespace,
          mcpDiscoveryElicitation: options?.mcpDiscoveryElicitation,
          resolveSecretMaterial,
        }),

  connectMcpSource: (sourceInput) =>
    connectMcpSourceInternal({
      rows: input.rows,
      getLocalServerBaseUrl: input.getLocalServerBaseUrl,
      workspaceId: sourceInput.workspaceId,
      sourceId: sourceInput.sourceId,
      executionId: null,
      interactionId: null,
      endpoint: sourceInput.endpoint,
      name: sourceInput.name,
      namespace: sourceInput.namespace,
      enabled: sourceInput.enabled,
      transport: sourceInput.transport,
      queryParams: sourceInput.queryParams,
      headers: sourceInput.headers,
      resolveSecretMaterial,
    }),

  completeSourceCredentialSetup: ({
    workspaceId,
    sourceId,
    state,
    code,
    error,
    errorDescription,
  }) =>
    Effect.gen(function* () {
      const sessionOption = yield* input.rows.sourceAuthSessions.getByState(state);
      if (Option.isNone(sessionOption)) {
        return yield* Effect.fail(new Error(`Source auth session not found for state ${state}`));
      }

      const session = sessionOption.value;
      if (session.workspaceId !== workspaceId || session.sourceId !== sourceId) {
        return yield* Effect.fail(
          new Error(
            `Source auth session ${session.id} does not match workspaceId=${workspaceId} sourceId=${sourceId}`,
          ),
        );
      }

      const source = yield* loadSourceById(input.rows, {
        workspaceId: session.workspaceId,
        sourceId: session.sourceId,
      });

      if (session.status === "completed") {
        return source;
      }

      if (session.status !== "pending") {
        return yield* Effect.fail(
          new Error(`Source auth session ${session.id} is not pending`),
        );
      }

      if (trimOrNull(error) !== null) {
        const reason = trimOrNull(errorDescription) ?? trimOrNull(error) ?? "OAuth authorization failed";
        const failedAt = Date.now();

        yield* input.rows.sourceAuthSessions.update(
          session.id,
          createTerminalSourceAuthSessionPatch({
            status: "failed",
            now: failedAt,
            errorText: reason,
            resourceMetadataUrl: session.resourceMetadataUrl,
            authorizationServerUrl: session.authorizationServerUrl,
            resourceMetadataJson: session.resourceMetadataJson,
            authorizationServerMetadataJson: session.authorizationServerMetadataJson,
          }),
        );
        const failedSource = yield* updateSourceStatus(input.rows, source, {
          status: "error",
          lastError: reason,
        });
        yield* syncSourceToolArtifacts({
          rows: input.rows,
          source: failedSource,
          resolveSecretMaterial,
        });
        yield* completeLiveInteraction({
          liveExecutionManager: input.liveExecutionManager,
          session,
          response: {
            action: "cancel",
            reason,
          },
        });

        return yield* Effect.fail(new Error(reason));
      }

      const authorizationCode = trimOrNull(code);
      if (authorizationCode === null) {
        return yield* Effect.fail(new Error("Missing OAuth authorization code"));
      }

      const exchanged = yield* exchangeOAuthAuthorizationCode({
        session,
        code: authorizationCode,
      });

      const accessTokenRef = yield* storeSecretMaterial({
        purpose: "oauth_access_token",
        value: exchanged.tokens.access_token,
      });
      const refreshTokenRef = exchanged.tokens.refresh_token
        ? yield* storeSecretMaterial({
            purpose: "oauth_refresh_token",
            value: exchanged.tokens.refresh_token,
          })
        : null;

      const now = Date.now();
      const connectedSource = yield* updateSourceStatus(input.rows, source, {
        status: "connected",
        lastError: null,
        auth: {
          kind: "oauth2",
          headerName: "Authorization",
          prefix: "Bearer ",
          accessToken: accessTokenRef,
          refreshToken: refreshTokenRef,
        },
      });
      const indexed = yield* Effect.either(
        syncSourceToolArtifacts({
          rows: input.rows,
          source: connectedSource,
          resolveSecretMaterial,
        }),
      );
      yield* Either.match(indexed, {
        onLeft: (error) =>
          updateSourceStatus(input.rows, connectedSource, {
            status: "error",
            lastError: error.message,
          }).pipe(
            Effect.zipRight(Effect.fail(error)),
          ),
        onRight: () => Effect.succeed(undefined),
      });

      yield* input.rows.sourceAuthSessions.update(
        session.id,
        createTerminalSourceAuthSessionPatch({
          status: "completed",
          now,
          errorText: null,
          resourceMetadataUrl: exchanged.resourceMetadataUrl,
          authorizationServerUrl: exchanged.authorizationServerUrl,
          resourceMetadataJson: exchanged.resourceMetadataJson,
          authorizationServerMetadataJson: exchanged.authorizationServerMetadataJson,
        }),
      );

      yield* completeLiveInteraction({
        liveExecutionManager: input.liveExecutionManager,
        session,
        response: {
          action: "accept",
        },
      });

      return connectedSource;
    }),
  } satisfies RuntimeSourceAuthServiceShape;
};

export type RuntimeSourceAuthService = RuntimeSourceAuthServiceShape;

export class RuntimeSourceAuthServiceTag extends Context.Tag(
  "#runtime/RuntimeSourceAuthServiceTag",
)<RuntimeSourceAuthServiceTag, ReturnType<typeof createRuntimeSourceAuthService>>() {}

export const RuntimeSourceAuthServiceLive = (input: {
  getLocalServerBaseUrl?: () => string | undefined;
} = {}) =>
  Layer.effect(
    RuntimeSourceAuthServiceTag,
    Effect.gen(function* () {
      const rows = yield* SqlControlPlaneRowsService;
      const liveExecutionManager = yield* LiveExecutionManagerService;

      return createRuntimeSourceAuthService({
        rows,
        liveExecutionManager,
        getLocalServerBaseUrl: input.getLocalServerBaseUrl,
      });
    }),
  );

export const ExecutorAddSourceResultSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("connected"),
    source: SourceSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("credential_required"),
    source: SourceSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth_required"),
    source: SourceSchema,
    sessionId: SourceAuthSessionIdSchema,
    authorizationUrl: Schema.String,
  }),
);

export type ExecutorAddSourceResult = typeof ExecutorAddSourceResultSchema.Type;
