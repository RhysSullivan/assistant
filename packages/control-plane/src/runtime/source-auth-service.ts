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
} from "@executor-v3/codemode-mcp";
import { type SqlControlPlaneRows } from "#persistence";
import {
  ExecutionIdSchema,
  SecretMaterialIdSchema,
  Source,
  SourceAuthSession,
  SourceAuthSessionIdSchema,
  SourceIdSchema,
  SourceSchema,
  type SecretRef,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { LiveExecutionManager } from "./live-execution";
import {
  createSourceFromPayload,
  projectSourceFromStorage,
  projectSourcesFromStorage,
  splitSourceForStorage,
  updateSourceFromPayload,
} from "./source-definitions";

export const CONTROL_PLANE_SECRET_PROVIDER_ID = "control-plane";
const OAUTH_CALLBACK_PATH = "/v1/local/oauth/callback";

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

const resolveRedirectUrl = (baseUrl: string): string =>
  new URL(OAUTH_CALLBACK_PATH, baseUrl).toString();

const normalizeEndpoint = (endpoint: string): string => {
  const url = new URL(endpoint.trim());
  return url.toString();
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const loadSourcesInWorkspace = (rows: SqlControlPlaneRows, workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const sourceRecords = yield* rows.sources.listByWorkspaceId(workspaceId);
    const credentialBindings = yield* rows.sourceCredentialBindings.listByWorkspaceId(workspaceId);

    return yield* projectSourcesFromStorage({
      sourceRecords,
      credentialBindings,
    });
  });

const loadSourceById = (rows: SqlControlPlaneRows, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}) =>
  Effect.gen(function* () {
    const sourceRecord = yield* rows.sources.getByWorkspaceAndId(
      input.workspaceId,
      input.sourceId,
    );

    if (Option.isNone(sourceRecord)) {
      return yield* Effect.fail(
        new Error(`Source not found: workspaceId=${input.workspaceId} sourceId=${input.sourceId}`),
      );
    }

    const credentialBinding = yield* rows.sourceCredentialBindings.getByWorkspaceAndSourceId(
      input.workspaceId,
      input.sourceId,
    );

    return yield* projectSourceFromStorage({
      sourceRecord: sourceRecord.value,
      credentialBinding: Option.isSome(credentialBinding) ? credentialBinding.value : null,
    });
  });

const persistSource = (rows: SqlControlPlaneRows, source: Source) =>
  Effect.gen(function* () {
    const { sourceRecord, credentialBinding } = splitSourceForStorage({ source });
    const existing = yield* rows.sources.getByWorkspaceAndId(source.workspaceId, source.id);

    if (Option.isNone(existing)) {
      yield* rows.sources.insert(sourceRecord);
    } else {
      const { id: _id, workspaceId: _workspaceId, createdAt: _createdAt, ...patch } = sourceRecord;
      yield* rows.sources.update(source.workspaceId, source.id, patch);
    }

    if (credentialBinding === null) {
      yield* rows.sourceCredentialBindings.removeByWorkspaceAndSourceId(
        source.workspaceId,
        source.id,
      );
    } else {
      yield* rows.sourceCredentialBindings.upsert(credentialBinding);
    }

    return source;
  });

const probeMcpSourceWithoutAuth = (source: Source) =>
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
  clientInformationJson: string | null;
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
        throw new Error("Unexpected redirect during OAuth callback completion");
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
      return yield* Effect.fail(new Error("OAuth callback did not complete authorization"));
    }

    return {
      tokens: captured.tokens,
      clientInformationJson: serializeJson(captured.clientInformation),
      resourceMetadataUrl: captured.discoveryState?.resourceMetadataUrl ?? null,
      authorizationServerUrl: captured.discoveryState?.authorizationServerUrl ?? null,
      resourceMetadataJson: serializeJson(captured.discoveryState?.resourceMetadata),
      authorizationServerMetadataJson: serializeJson(
        captured.discoveryState?.authorizationServerMetadata,
      ),
    } satisfies ExchangedTokens;
  });

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
  persistSource(rows, {
    ...source,
    status: input.status,
    lastError: input.lastError ?? null,
    auth: input.auth ?? source.auth,
    updatedAt: Date.now(),
  });

const upsertSecretMaterial = (rows: SqlControlPlaneRows, input: {
  purpose: "oauth_access_token" | "oauth_refresh_token";
  value: string;
}) =>
  Effect.gen(function* () {
    const now = Date.now();
    const materialId = SecretMaterialIdSchema.make(`sec_${crypto.randomUUID()}`);
    yield* rows.secretMaterials.upsert({
      id: materialId,
      purpose: input.purpose,
      value: input.value,
      createdAt: now,
      updatedAt: now,
    });

    return materialId;
  });

export type ExecutorSourceAddResult =
  | {
      kind: "connected";
      source: Source;
    }
  | {
      kind: "oauth_required";
      source: Source;
      sessionId: SourceAuthSession["id"];
      authorizationUrl: string;
    };

export type RuntimeSourceAuthService = {
  getSourceById: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
  }) => Effect.Effect<Source, Error, never>;
  addExecutorMcpSource: (input: {
    workspaceId: WorkspaceId;
    executionId: SourceAuthSession["executionId"];
    interactionId: SourceAuthSession["interactionId"];
    endpoint: string;
    name?: string | null;
    namespace?: string | null;
  }) => Effect.Effect<ExecutorSourceAddResult, Error, never>;
  completeSourceAuthCallback: (input: {
    state: string;
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  }) => Effect.Effect<Source, Error, never>;
};

export type ResolveSecretMaterial = (ref: SecretRef) => Effect.Effect<string, Error, never>;

export const createDbBackedSecretMaterialResolver = (input: {
  rows: SqlControlPlaneRows;
  fallback?: ResolveSecretMaterial;
}): ResolveSecretMaterial =>
  (ref) =>
    Effect.gen(function* () {
      if (ref.providerId === CONTROL_PLANE_SECRET_PROVIDER_ID) {
        const materialId = SecretMaterialIdSchema.make(ref.handle);
        const stored = yield* input.rows.secretMaterials.getById(materialId);
        if (Option.isNone(stored)) {
          return yield* Effect.fail(
            new Error(`Secret material not found: ${ref.handle}`),
          );
        }

        return stored.value.value;
      }

      if (input.fallback) {
        return yield* input.fallback(ref);
      }

      return yield* Effect.fail(
        new Error(`Unsupported secret provider ${ref.providerId}`),
      );
    });

export const createRuntimeSourceAuthService = (input: {
  rows: SqlControlPlaneRows;
  liveExecutionManager: LiveExecutionManager;
  getLocalServerBaseUrl?: () => string | undefined;
}): RuntimeSourceAuthService => ({
  getSourceById: ({ workspaceId, sourceId }) =>
    loadSourceById(input.rows, {
      workspaceId,
      sourceId,
    }),

  addExecutorMcpSource: ({
    workspaceId,
    executionId,
    interactionId,
    endpoint,
    name,
    namespace,
  }) =>
    Effect.gen(function* () {
      const normalizedEndpoint = normalizeEndpoint(endpoint);
      const existingSources = yield* loadSourcesInWorkspace(input.rows, workspaceId);
      const existing = existingSources.find(
        (source) => source.kind === "mcp" && normalizeEndpoint(source.endpoint) === normalizedEndpoint,
      );

      const chosenName =
        trimOrNull(name)
        ?? existing?.name
        ?? defaultSourceNameFromEndpoint(normalizedEndpoint);
      const chosenNamespace =
        trimOrNull(namespace)
        ?? existing?.namespace
        ?? defaultNamespaceFromName(chosenName);
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
              enabled: true,
              transport: existing.transport ?? "auto",
              auth: { kind: "none" },
              lastError: null,
            },
            now,
          })
        : yield* createSourceFromPayload({
            workspaceId,
            sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
            payload: {
              name: chosenName,
              kind: "mcp",
              endpoint: normalizedEndpoint,
              namespace: chosenNamespace,
              status: "probing",
              enabled: true,
              transport: "auto",
              auth: { kind: "none" },
            },
            now,
          });

      const persistedDraft = yield* persistSource(input.rows, draftSource);

      const discovered = yield* Effect.either(
        probeMcpSourceWithoutAuth(persistedDraft),
      );

      if (discovered._tag === "Right") {
        const connected = yield* updateSourceStatus(input.rows, persistedDraft, {
          status: "connected",
          lastError: null,
          auth: { kind: "none" },
        });

        return {
          kind: "connected",
          source: connected,
        } satisfies ExecutorSourceAddResult;
      }

      const localServerBaseUrl = input.getLocalServerBaseUrl?.();
      if (!localServerBaseUrl) {
        return yield* Effect.fail(
          new Error("Local executor server base URL is unavailable for OAuth callback handling"),
        );
      }

      const sessionId = SourceAuthSessionIdSchema.make(`src_auth_${crypto.randomUUID()}`);
      const state = crypto.randomUUID();
      const redirectUrl = resolveRedirectUrl(localServerBaseUrl);
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
        workspaceId,
        sourceId: authRequiredSource.id,
        executionId,
        interactionId,
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
      } satisfies ExecutorSourceAddResult;
    }),

  completeSourceAuthCallback: ({ state, code, error, errorDescription }) =>
    Effect.gen(function* () {
      const sessionOption = yield* input.rows.sourceAuthSessions.getByState(state);
      if (Option.isNone(sessionOption)) {
        return yield* Effect.fail(new Error(`Source auth session not found for state ${state}`));
      }

      const session = sessionOption.value;
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

        yield* input.rows.sourceAuthSessions.update(session.id, {
          status: "failed",
          errorText: reason,
          completedAt: failedAt,
          updatedAt: failedAt,
        });
        yield* updateSourceStatus(input.rows, source, {
          status: "error",
          lastError: reason,
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

      const accessTokenId = yield* upsertSecretMaterial(input.rows, {
        purpose: "oauth_access_token",
        value: exchanged.tokens.access_token,
      });
      const refreshTokenId = exchanged.tokens.refresh_token
        ? yield* upsertSecretMaterial(input.rows, {
            purpose: "oauth_refresh_token",
            value: exchanged.tokens.refresh_token,
          })
        : null;

      const now = Date.now();
      yield* input.rows.sourceCredentialBindings.upsert({
        workspaceId: session.workspaceId,
        sourceId: session.sourceId,
        tokenProviderId: CONTROL_PLANE_SECRET_PROVIDER_ID,
        tokenHandle: accessTokenId,
        refreshTokenProviderId:
          refreshTokenId === null ? null : CONTROL_PLANE_SECRET_PROVIDER_ID,
        refreshTokenHandle: refreshTokenId,
        createdAt: now,
        updatedAt: now,
      });

      const connectedSource = yield* updateSourceStatus(input.rows, source, {
        status: "connected",
        lastError: null,
        auth: {
          kind: "oauth2",
          headerName: "Authorization",
          prefix: "Bearer ",
          accessToken: {
            providerId: CONTROL_PLANE_SECRET_PROVIDER_ID,
            handle: accessTokenId,
          },
          refreshToken:
            refreshTokenId === null
              ? null
              : {
                  providerId: CONTROL_PLANE_SECRET_PROVIDER_ID,
                  handle: refreshTokenId,
                },
        },
      });

      yield* input.rows.sourceAuthSessions.update(session.id, {
        status: "completed",
        errorText: null,
        completedAt: now,
        updatedAt: now,
        resourceMetadataUrl: exchanged.resourceMetadataUrl,
        authorizationServerUrl: exchanged.authorizationServerUrl,
        resourceMetadataJson: exchanged.resourceMetadataJson,
        authorizationServerMetadataJson: exchanged.authorizationServerMetadataJson,
        clientInformationJson: exchanged.clientInformationJson,
      });

      yield* completeLiveInteraction({
        liveExecutionManager: input.liveExecutionManager,
        session,
        response: {
          action: "accept",
        },
      });

      return connectedSource;
    }),
});

export const ExecutorAddSourceResultSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("connected"),
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
