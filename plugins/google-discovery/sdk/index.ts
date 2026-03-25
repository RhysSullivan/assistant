import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  createCatalogImportMetadata,
  createSourceCatalogSyncResult,
} from "@executor/source-core";
import type { Source } from "@executor/platform-sdk/schema";
import type {
  ExecutorSdkPlugin,
  ExecutorSdkPluginHost,
  ExecutorSourceConnector,
  SourcePluginRuntime,
} from "@executor/platform-sdk/plugins";
import {
  SecretMaterialDeleterService,
  SecretMaterialResolverService,
  SecretMaterialStorerService,
  SecretMaterialUpdaterService,
  provideExecutorRuntime,
} from "@executor/platform-sdk/runtime";
import {
  GoogleDiscoveryConnectionAuthSchema,
  GoogleDiscoveryOAuthSessionSchema,
  defaultGoogleDiscoveryUrl,
  deriveGoogleDiscoveryNamespace,
  GoogleDiscoveryStoredSourceDataSchema,
  type GoogleDiscoveryConnectInput,
  type GoogleDiscoveryConnectionAuth,
  type GoogleDiscoveryOAuthPopupResult,
  type GoogleDiscoveryOAuthSession,
  type GoogleDiscoverySourceConfigPayload,
  type GoogleDiscoveryStartOAuthInput,
  type GoogleDiscoveryStartOAuthResult,
  type GoogleDiscoveryStoredSourceData,
  type GoogleDiscoveryUpdateSourceInput,
} from "@executor/plugin-google-discovery-shared";

import {
  createGoogleDiscoveryCatalogFragment,
  type GoogleDiscoveryCatalogOperationInput,
} from "./catalog";
import {
  compileGoogleDiscoveryToolDefinitions,
  extractGoogleDiscoveryManifest,
} from "./document";
import {
  buildGoogleDiscoveryToolPresentation,
} from "./tools";
import {
  GoogleDiscoveryToolProviderDataSchema,
  type GoogleDiscoveryToolManifest,
  type GoogleDiscoveryToolProviderData,
} from "./types";
import {
  buildOAuth2AuthorizationUrl,
  createPkceCodeVerifier,
  exchangeOAuth2AuthorizationCode,
  refreshOAuth2AccessToken,
} from "./oauth2";

const decodeStoredSourceData = Schema.decodeUnknownSync(
  GoogleDiscoveryStoredSourceDataSchema,
);
const decodeSession = Schema.decodeUnknownSync(GoogleDiscoveryOAuthSessionSchema);
const decodeProviderData = Schema.decodeUnknownSync(GoogleDiscoveryToolProviderDataSchema);

export type GoogleDiscoverySourceStorage = {
  get: (input: {
    scopeId: string;
    sourceId: string;
  }) => Effect.Effect<GoogleDiscoveryStoredSourceData | null, Error, never>;
  put: (input: {
    scopeId: string;
    sourceId: string;
    value: GoogleDiscoveryStoredSourceData;
  }) => Effect.Effect<void, Error, never>;
  remove?: (input: {
    scopeId: string;
    sourceId: string;
  }) => Effect.Effect<void, Error, never>;
};

export type GoogleDiscoveryOAuthSessionStorage = {
  get: (sessionId: string) => Effect.Effect<GoogleDiscoveryOAuthSession | null, Error, never>;
  put: (input: {
    sessionId: string;
    value: GoogleDiscoveryOAuthSession;
  }) => Effect.Effect<void, Error, never>;
  remove?: (sessionId: string) => Effect.Effect<void, Error, never>;
};

export type GoogleDiscoverySdk = {
  getSourceConfig: (
    sourceId: Source["id"],
  ) => Effect.Effect<GoogleDiscoverySourceConfigPayload, Error>;
  createSource: (
    input: GoogleDiscoveryConnectInput,
  ) => Effect.Effect<Source, Error>;
  updateSource: (
    input: GoogleDiscoveryUpdateSourceInput,
  ) => Effect.Effect<Source, Error>;
  removeSource: (
    sourceId: Source["id"],
  ) => Effect.Effect<boolean, Error>;
  startOAuth: (
    input: GoogleDiscoveryStartOAuthInput,
  ) => Effect.Effect<GoogleDiscoveryStartOAuthResult, Error>;
  completeOAuth: (input: {
    state: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }) => Effect.Effect<Extract<GoogleDiscoveryOAuthPopupResult, { ok: true }>, Error>;
};

const GoogleDiscoveryExecutorAddInputSchema = Schema.Struct({
  kind: Schema.Literal("google_discovery"),
  name: Schema.String,
  service: Schema.String,
  version: Schema.String,
  discoveryUrl: Schema.NullOr(Schema.String),
  defaultHeaders: Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.String })),
  scopes: Schema.Array(Schema.String),
  auth: GoogleDiscoveryConnectionAuthSchema,
});

type GoogleDiscoveryExecutorAddInput =
  typeof GoogleDiscoveryExecutorAddInputSchema.Type;

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const OAUTH_REFRESH_SKEW_MS = 60_000;

const responseHeadersRecord = (response: Response): Record<string, string> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

const decodeResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValuesFromParameter = (
  value: unknown,
  repeated: boolean,
): string[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    const normalized = value.flatMap((entry) =>
      entry === undefined || entry === null ? [] : [String(entry)],
    );
    return repeated ? normalized : [normalized.join(",")];
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [String(value)];
  }
  return [JSON.stringify(value)];
};

const replacePathParameters = (input: {
  pathTemplate: string;
  args: Record<string, unknown>;
  parameters: ReadonlyArray<
    GoogleDiscoveryToolProviderData["invocation"]["parameters"][number]
  >;
}): string =>
  input.pathTemplate.replaceAll(/\{([^}]+)\}/g, (_, name: string) => {
    const parameter = input.parameters.find(
      (entry) => entry.location === "path" && entry.name === name,
    );
    const rawValue = input.args[name];
    if ((rawValue === undefined || rawValue === null) && parameter?.required) {
      throw new Error(`Missing required path parameter: ${name}`);
    }

    const values = stringValuesFromParameter(rawValue, false);
    return values.length > 0 ? encodeURIComponent(values[0]!) : "";
  });

const resolveGoogleDiscoveryBaseUrl = (input: {
  providerData: GoogleDiscoveryToolProviderData;
}): string =>
  new URL(
    input.providerData.invocation.servicePath || "",
    input.providerData.invocation.rootUrl,
  ).toString();

const googleDiscoveryCatalogOperationFromDefinition = (input: {
  manifest: Parameters<typeof compileGoogleDiscoveryToolDefinitions>[0];
  definition: ReturnType<typeof compileGoogleDiscoveryToolDefinitions>[number];
}): GoogleDiscoveryCatalogOperationInput => {
  const presentation = buildGoogleDiscoveryToolPresentation({
    manifest: input.manifest,
    definition: input.definition,
  });

  return {
    toolId: input.definition.toolId,
    title: input.definition.name,
    description: input.definition.description,
    effect:
      input.definition.method === "get" || input.definition.method === "head"
        ? "read"
        : input.definition.method === "delete"
          ? "delete"
          : "write",
    inputSchema: presentation.inputSchema,
    outputSchema: presentation.outputSchema,
    providerData: presentation.providerData as GoogleDiscoveryToolProviderData,
  };
};

const computeMaximalScopes = (
  manifest: GoogleDiscoveryToolManifest,
): ReadonlyArray<string> => {
  const topLevelScopes = Object.keys(manifest.oauthScopes ?? {});
  if (topLevelScopes.length === 0) {
    return [];
  }

  const scopeToMethods = new Map<string, Set<string>>();
  for (const scope of topLevelScopes) {
    scopeToMethods.set(scope, new Set());
  }
  for (const method of manifest.methods) {
    for (const scope of method.scopes) {
      scopeToMethods.get(scope)?.add(method.methodId);
    }
  }

  return topLevelScopes.filter((scope) => {
    const methods = scopeToMethods.get(scope);
    if (!methods || methods.size === 0) {
      return true;
    }

    return !topLevelScopes.some((other) => {
      if (other === scope) {
        return false;
      }

      const otherMethods = scopeToMethods.get(other);
      if (!otherMethods || otherMethods.size <= methods.size) {
        return false;
      }

      for (const method of methods) {
        if (!otherMethods.has(method)) {
          return false;
        }
      }

      return true;
    });
  });
};

const fetchGoogleDiscoveryDocumentWithHeaders = (input: {
  url: string;
  headers?: Readonly<Record<string, string>>;
}): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(input.url, {
        headers: input.headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Google Discovery fetch requires credentials (status ${response.status})`,
        );
      }
      if (!response.ok) {
        throw new Error(`Google Discovery fetch failed with status ${response.status}`);
      }
      return response.text();
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

const inferScopesFromDiscoveryDocument = (input: {
  service: string;
  document: string;
}): Effect.Effect<ReadonlyArray<string>, Error> =>
  Effect.gen(function* () {
    const manifest = yield* extractGoogleDiscoveryManifest(input.service, input.document);
    return computeMaximalScopes(manifest);
  });

const resolveOauthAccessToken = (input: {
  scopeId: string;
  sourceId: string;
  auth: Extract<GoogleDiscoveryConnectionAuth, { kind: "oauth2" }>;
  storage: GoogleDiscoverySourceStorage;
}): Effect.Effect<string, Error, any> =>
  Effect.gen(function* () {
    const now = Date.now();
    const needsRefresh =
      input.auth.refreshTokenRef !== null &&
      input.auth.expiresAt !== null &&
      input.auth.expiresAt <= now + OAUTH_REFRESH_SKEW_MS;
    if (!needsRefresh) {
      const resolveSecretMaterial = yield* SecretMaterialResolverService;
      return yield* resolveSecretMaterial({
        ref: input.auth.accessTokenRef,
      });
    }

    const resolveSecretMaterial = yield* SecretMaterialResolverService;
    const updateSecretMaterial = yield* SecretMaterialUpdaterService;
    const storeSecretMaterial = yield* SecretMaterialStorerService;
    const refreshToken = yield* resolveSecretMaterial({
      ref: input.auth.refreshTokenRef!,
    });
    const clientSecret = input.auth.clientSecretRef
      ? yield* resolveSecretMaterial({
          ref: input.auth.clientSecretRef,
        })
      : null;
    const tokenResponse = yield* refreshOAuth2AccessToken({
      tokenEndpoint: input.auth.tokenEndpoint,
      clientId: input.auth.clientId,
      clientAuthentication: input.auth.clientAuthentication,
      clientSecret,
      refreshToken,
      scopes: input.auth.scopes,
    });

    yield* updateSecretMaterial({
      ref: input.auth.accessTokenRef,
      value: tokenResponse.access_token,
    });

    let refreshTokenRef = input.auth.refreshTokenRef;
    if (tokenResponse.refresh_token) {
      if (refreshTokenRef) {
        yield* updateSecretMaterial({
          ref: refreshTokenRef,
          value: tokenResponse.refresh_token,
        });
      } else {
        refreshTokenRef = yield* storeSecretMaterial({
          purpose: "oauth_refresh_token",
          value: tokenResponse.refresh_token,
          name: `${input.sourceId} Google Refresh Token`,
        });
      }
    }

    const stored = yield* input.storage.get({
      scopeId: input.scopeId,
      sourceId: input.sourceId,
    });
    if (stored) {
      yield* input.storage.put({
        scopeId: input.scopeId,
        sourceId: input.sourceId,
        value: decodeStoredSourceData({
          ...stored,
          auth: {
            ...stored.auth,
            ...(stored.auth.kind === "oauth2"
              ? {
                  refreshTokenRef,
                  expiresAt:
                    typeof tokenResponse.expires_in === "number"
                      ? Date.now() + tokenResponse.expires_in * 1000
                      : stored.auth.expiresAt,
                }
              : {}),
          },
        }),
      });
    }

    return tokenResponse.access_token;
  });

const resolveGoogleAuthHeaders = (input: {
  scopeId: string;
  sourceId: string;
  stored: GoogleDiscoveryStoredSourceData;
  storage: GoogleDiscoverySourceStorage;
}): Effect.Effect<Record<string, string>, Error, any> =>
  Effect.gen(function* () {
    if (input.stored.auth.kind === "none") {
      return {
        ...(input.stored.defaultHeaders ?? {}),
      };
    }

    if (input.stored.auth.kind === "bearer") {
      const resolveSecretMaterial = yield* SecretMaterialResolverService;
      const token = yield* resolveSecretMaterial({
        ref: input.stored.auth.tokenSecretRef,
      });
      return {
        ...(input.stored.defaultHeaders ?? {}),
        authorization: `Bearer ${token.trim()}`,
      };
    }

    const token = yield* resolveOauthAccessToken({
      scopeId: input.scopeId,
      sourceId: input.sourceId,
      auth: input.stored.auth,
      storage: input.storage,
    });

    return {
      ...(input.stored.defaultHeaders ?? {}),
      authorization: `Bearer ${token.trim()}`,
    };
  });

const storedSourceDataFromInput = (
  input: GoogleDiscoveryConnectInput,
): GoogleDiscoveryStoredSourceData =>
  decodeStoredSourceData({
    service: input.service.trim(),
    version: input.version.trim(),
    discoveryUrl: input.discoveryUrl?.trim() || defaultGoogleDiscoveryUrl(input.service, input.version),
    defaultHeaders: input.defaultHeaders,
    scopes: [...input.scopes],
    auth: input.auth,
  });

const sourceConfigFromStored = (
  source: Source,
  stored: GoogleDiscoveryStoredSourceData,
): GoogleDiscoverySourceConfigPayload => ({
  name: source.name,
  service: stored.service,
  version: stored.version,
  discoveryUrl: stored.discoveryUrl,
  defaultHeaders: stored.defaultHeaders,
  scopes: [...stored.scopes],
  auth: stored.auth,
});

const createGoogleDiscoverySourceSdk = (
  options: {
    storage: GoogleDiscoverySourceStorage;
    oauthSessions: GoogleDiscoveryOAuthSessionStorage;
  },
  host: ExecutorSdkPluginHost,
) => ({
  getSourceConfig: (sourceId: Source["id"]) =>
    Effect.gen(function* () {
      const source = yield* host.sources.get(sourceId);
      if (source.kind !== "google_discovery") {
        return yield* Effect.fail(
          new Error(`Source ${sourceId} is not a Google Discovery source.`),
        );
      }

      const stored = yield* options.storage.get({
        scopeId: source.scopeId,
        sourceId: source.id,
      });
      if (stored === null) {
        return yield* Effect.fail(
          new Error(`Google Discovery source storage missing for ${source.id}`),
        );
      }

      return sourceConfigFromStored(source, stored);
    }),
  createSource: (input: GoogleDiscoveryConnectInput) =>
    Effect.gen(function* () {
      const stored = storedSourceDataFromInput(input);
      const createdSource = yield* host.sources.create({
        source: {
          name: input.name.trim(),
          kind: "google_discovery",
          status: "connected",
          enabled: true,
          namespace: deriveGoogleDiscoveryNamespace(input.service),
        },
      });

      yield* options.storage.put({
        scopeId: createdSource.scopeId,
        sourceId: createdSource.id,
        value: stored,
      });

      return yield* host.sources.refreshCatalog(createdSource.id);
    }),
  updateSource: (input: GoogleDiscoveryUpdateSourceInput) =>
    Effect.gen(function* () {
      const source = yield* host.sources.get(input.sourceId as Source["id"]);
      if (source.kind !== "google_discovery") {
        return yield* Effect.fail(
          new Error(`Source ${input.sourceId} is not a Google Discovery source.`),
        );
      }

      const stored = storedSourceDataFromInput(input.config);
      const savedSource = yield* host.sources.save({
        ...source,
        name: input.config.name.trim(),
        namespace: deriveGoogleDiscoveryNamespace(input.config.service),
      });

      yield* options.storage.put({
        scopeId: savedSource.scopeId,
        sourceId: savedSource.id,
        value: stored,
      });

      return yield* host.sources.refreshCatalog(savedSource.id);
    }),
  removeSource: (sourceId: Source["id"]) =>
    Effect.gen(function* () {
      const source = yield* host.sources.get(sourceId);
      if (source.kind !== "google_discovery") {
        return yield* Effect.fail(
          new Error(`Source ${sourceId} is not a Google Discovery source.`),
        );
      }

      const stored = yield* options.storage.get({
        scopeId: source.scopeId,
        sourceId: source.id,
      });
      const deleteSecretMaterial = yield* SecretMaterialDeleterService;
      if (stored?.auth.kind === "oauth2") {
        yield* Effect.either(deleteSecretMaterial(stored.auth.accessTokenRef));
        if (stored.auth.refreshTokenRef) {
          yield* Effect.either(deleteSecretMaterial(stored.auth.refreshTokenRef));
        }
      }

      if (options.storage.remove) {
        yield* options.storage.remove({
          scopeId: source.scopeId,
          sourceId: source.id,
        });
      }

      return yield* host.sources.remove(source.id);
    }),
});

const googleDiscoverySourceConnector = (
  options: {
    storage: GoogleDiscoverySourceStorage;
    oauthSessions: GoogleDiscoveryOAuthSessionStorage;
  },
): ExecutorSourceConnector<GoogleDiscoveryExecutorAddInput> => ({
  kind: "google_discovery",
  displayName: "Google Discovery",
  inputSchema: GoogleDiscoveryExecutorAddInputSchema,
  inputSignatureWidth: 320,
  helpText: [
    "Provide the Google API service and version plus the final auth configuration.",
    "OAuth browser flows stay on the plugin-owned HTTP/UI surfaces.",
  ],
  createSource: ({ args, host }) =>
    createGoogleDiscoverySourceSdk(options, host).createSource(args),
});

const createGoogleDiscoverySourceRuntime = (options: {
  storage: GoogleDiscoverySourceStorage;
}): SourcePluginRuntime => ({
  kind: "google_discovery",
  displayName: "Google Discovery",
  catalogKind: "imported",
  catalogIdentity: ({ source }) => ({
    kind: "google_discovery",
    sourceId: source.id,
  }),
  getIrModel: ({ source }) =>
    Effect.gen(function* () {
      const stored = yield* options.storage.get({
        scopeId: source.scopeId,
        sourceId: source.id,
      });
      if (stored === null) {
        return createSourceCatalogSyncResult({
          fragment: {
            version: "ir.v1.fragment",
          },
          importMetadata: {
            ...createCatalogImportMetadata({
              source,
              pluginKey: "google_discovery",
            }),
            importerVersion: "ir.v1.google_discovery",
            sourceConfigHash: "missing",
          },
          sourceHash: null,
        });
      }

      const headers = yield* resolveGoogleAuthHeaders({
        scopeId: source.scopeId,
        sourceId: source.id,
        stored,
        storage: options.storage,
      });
      const document = yield* fetchGoogleDiscoveryDocumentWithHeaders({
        url: stored.discoveryUrl,
        headers,
      });
      const manifest = yield* extractGoogleDiscoveryManifest(source.name, document);
      const definitions = compileGoogleDiscoveryToolDefinitions(manifest);
      const operations = definitions.map((definition) =>
        googleDiscoveryCatalogOperationFromDefinition({
          manifest,
          definition,
        })
      );
      const now = Date.now();

      return createSourceCatalogSyncResult({
        fragment: createGoogleDiscoveryCatalogFragment({
          source,
          documents: [
            {
              documentKind: "google_discovery",
              documentKey: stored.discoveryUrl,
              contentText: document,
              fetchedAt: now,
            },
          ],
          operations,
        }),
        importMetadata: {
          ...createCatalogImportMetadata({
            source,
            pluginKey: "google_discovery",
          }),
          importerVersion: "ir.v1.google_discovery",
        },
        sourceHash: manifest.sourceHash,
      });
    }),
  invoke: (input) =>
    Effect.gen(function* () {
      const stored = yield* options.storage.get({
        scopeId: input.source.scopeId,
        sourceId: input.source.id,
      });
      if (stored === null) {
        return yield* Effect.fail(
          new Error(`Google Discovery source storage missing for ${input.source.id}`),
        );
      }

      const providerData = decodeProviderData(
        input.executable.binding,
      ) as GoogleDiscoveryToolProviderData;
      const args = asRecord(input.args);
      const headers: Record<string, string> = yield* resolveGoogleAuthHeaders({
        scopeId: input.source.scopeId,
        sourceId: input.source.id,
        stored,
        storage: options.storage,
      });
      const requestUrl = new URL(
        replacePathParameters({
          pathTemplate: providerData.invocation.path,
          args,
          parameters: providerData.invocation.parameters,
        }),
        resolveGoogleDiscoveryBaseUrl({
          providerData,
        }),
      );

      let body: string | undefined;
      for (const parameter of providerData.invocation.parameters) {
        const rawValue = args[parameter.name];
        if (rawValue === undefined || rawValue === null) {
          continue;
        }

        if (parameter.location === "query") {
          for (const entry of stringValuesFromParameter(rawValue, parameter.repeated)) {
            requestUrl.searchParams.append(parameter.name, entry);
          }
          continue;
        }

        if (parameter.location === "header") {
          headers[parameter.name] = stringValuesFromParameter(rawValue, false)[0] ?? "";
        }
      }

      if (providerData.invocation.requestSchemaId) {
        const payload = args.body ?? args.input;
        if (payload !== undefined) {
          headers["content-type"] = "application/json";
          body = JSON.stringify(payload);
        }
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(requestUrl.toString(), {
            method: providerData.invocation.method.toUpperCase(),
            headers,
            ...(body ? { body } : {}),
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      const responseBody = yield* Effect.tryPromise({
        try: () => decodeResponseBody(response),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      return {
        data: response.ok ? responseBody : null,
        error: response.ok ? null : responseBody,
        headers: responseHeadersRecord(response),
        status: response.status,
      };
    }),
});

export const googleDiscoverySdkPlugin = (options: {
  storage: GoogleDiscoverySourceStorage;
  oauthSessions: GoogleDiscoveryOAuthSessionStorage;
}): ExecutorSdkPlugin<"googleDiscovery", GoogleDiscoverySdk> => ({
  key: "googleDiscovery",
  sources: [createGoogleDiscoverySourceRuntime(options)],
  sourceConnectors: [googleDiscoverySourceConnector(options)],
  extendExecutor: ({ host, executor }) => {
    const sourceSdk = createGoogleDiscoverySourceSdk(options, host);
    const provideRuntime = <A>(
      effect: Effect.Effect<A, Error, any>,
    ): Effect.Effect<A, Error, never> =>
      provideExecutorRuntime(effect, executor.runtime);

    return {
      getSourceConfig: (sourceId) =>
        provideRuntime(sourceSdk.getSourceConfig(sourceId)),
      createSource: (input) =>
        provideRuntime(sourceSdk.createSource(input)),
      updateSource: (input) =>
        provideRuntime(sourceSdk.updateSource(input)),
      removeSource: (sourceId) =>
        provideRuntime(sourceSdk.removeSource(sourceId)),
      startOAuth: (input) =>
        provideRuntime(
          Effect.gen(function* () {
            const discoveryUrl =
              input.discoveryUrl?.trim()
              || defaultGoogleDiscoveryUrl(input.service, input.version);
            const scopes =
              input.scopes.length > 0
                ? [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))]
                : yield* fetchGoogleDiscoveryDocumentWithHeaders({
                    url: discoveryUrl,
                    headers: input.defaultHeaders ?? {},
                  }).pipe(
                    Effect.flatMap((document) =>
                      inferScopesFromDiscoveryDocument({
                        service: input.service,
                        document,
                      })
                    ),
                  );
            const sessionId = `gdisc_oauth_${crypto.randomUUID()}`;
            const codeVerifier = createPkceCodeVerifier();

            yield* options.oauthSessions.put({
              sessionId,
              value: decodeSession({
                service: input.service.trim(),
                version: input.version.trim(),
                discoveryUrl,
                defaultHeaders: input.defaultHeaders,
                scopes: [...scopes],
                clientId: input.clientId.trim(),
                clientSecretRef: input.clientSecretRef,
                clientAuthentication: input.clientAuthentication,
                redirectUrl: input.redirectUrl,
                codeVerifier,
              }),
            });

            return {
              sessionId,
              authorizationUrl: buildOAuth2AuthorizationUrl({
                authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
                clientId: input.clientId.trim(),
                redirectUri: input.redirectUrl,
                scopes,
                state: sessionId,
                codeVerifier,
                extraParams: {
                  access_type: "offline",
                  prompt: "consent",
                  include_granted_scopes: "true",
                },
              }),
              scopes: [...scopes],
            };
          }),
        ),
      completeOAuth: (input) =>
        provideRuntime(
          Effect.gen(function* () {
            if (input.error) {
              return yield* Effect.fail(
                new Error(
                  input.errorDescription || input.error || "Google OAuth failed",
                ),
              );
            }
            if (!input.code) {
              return yield* Effect.fail(new Error("Missing Google OAuth code."));
            }

            const session = yield* options.oauthSessions.get(input.state);
            if (session === null) {
              return yield* Effect.fail(
                new Error(`Google OAuth session not found: ${input.state}`),
              );
            }

            const resolveSecretMaterial = yield* SecretMaterialResolverService;
            const storeSecretMaterial = yield* SecretMaterialStorerService;
            const clientSecret = session.clientSecretRef
              ? yield* resolveSecretMaterial({
                  ref: session.clientSecretRef,
                })
              : null;
            const tokenResponse = yield* exchangeOAuth2AuthorizationCode({
              tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
              clientId: session.clientId,
              clientAuthentication: session.clientAuthentication,
              clientSecret,
              redirectUri: session.redirectUrl,
              codeVerifier: session.codeVerifier,
              code: input.code,
            });
            const accessTokenRef = yield* storeSecretMaterial({
              purpose: "oauth_access_token",
              value: tokenResponse.access_token,
              name: `${session.service} Google Access Token`,
            });
            const refreshTokenRef = tokenResponse.refresh_token
              ? yield* storeSecretMaterial({
                  purpose: "oauth_refresh_token",
                  value: tokenResponse.refresh_token,
                  name: `${session.service} Google Refresh Token`,
                })
              : null;

            if (options.oauthSessions.remove) {
              yield* options.oauthSessions.remove(input.state);
            }

            return {
              type: "executor:oauth-result",
              ok: true as const,
              sessionId: input.state,
              auth: {
                kind: "oauth2" as const,
                clientId: session.clientId,
                clientSecretRef: session.clientSecretRef,
                clientAuthentication: session.clientAuthentication,
                authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
                tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
                scopes: [...session.scopes],
                accessTokenRef,
                refreshTokenRef,
                expiresAt:
                  typeof tokenResponse.expires_in === "number"
                    ? Date.now() + tokenResponse.expires_in * 1000
                    : null,
              },
            };
          }),
        ),
    };
  },
});
