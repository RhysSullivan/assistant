// ---------------------------------------------------------------------------
// OAuth 2.0 metadata discovery + DCR.
//
// The token-endpoint helpers in `./oauth-helpers.ts` assume the caller
// already knows the authorization/token URLs and client_id — that's
// fine for static integrations (Google, a specific OpenAPI server).
// The zero-config case — user pastes an arbitrary endpoint URL and we
// figure out its OAuth configuration — needs three more building blocks:
//
//   - RFC 9728 Protected Resource Metadata (/.well-known/oauth-protected-resource)
//   - RFC 8414 Authorization Server Metadata (/.well-known/oauth-authorization-server,
//     with OIDC /.well-known/openid-configuration as fallback)
//   - RFC 7591 Dynamic Client Registration (POST `registration_endpoint`)
//
// The discovery path uses Effect HttpClient throughout so tests can provide
// realistic local HTTP services without patching `globalThis.fetch`. A
// convenience `beginDynamicAuthorization` chains all three into the single
// call callers actually need.
// ---------------------------------------------------------------------------

import { Data, Duration, Effect, Layer, Option, Predicate, Result, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  OAUTH2_DEFAULT_TIMEOUT_MS,
  buildAuthorizationUrl,
  createPkceCodeChallenge,
  createPkceCodeVerifier,
} from "./oauth-helpers";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Separate tag from `OAuth2Error` so callers can distinguish discovery
 *  / DCR failures (happen once, before any token round-trips) from
 *  token-endpoint failures. A plugin's refresh path should never have
 *  to inspect error messages to tell "metadata drifted, re-discover"
 *  apart from "refresh token is no longer honoured". */
export class OAuthDiscoveryError extends Data.TaggedError("OAuthDiscoveryError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Schemas (narrow structural parsing — the RFCs leave many fields
// optional; we validate only the subset consumers read)
// ---------------------------------------------------------------------------

const StringArray = Schema.Array(Schema.String);

export const OAuthProtectedResourceMetadataSchema = Schema.Struct({
  resource: Schema.optional(Schema.String),
  authorization_servers: Schema.optional(StringArray),
  scopes_supported: Schema.optional(StringArray),
  bearer_methods_supported: Schema.optional(StringArray),
  resource_documentation: Schema.optional(Schema.String),
}).annotate({ identifier: "OAuthProtectedResourceMetadata" });
export type OAuthProtectedResourceMetadata = typeof OAuthProtectedResourceMetadataSchema.Type;

export const OAuthAuthorizationServerMetadataSchema = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optional(Schema.String),
  scopes_supported: Schema.optional(StringArray),
  response_types_supported: Schema.optional(StringArray),
  grant_types_supported: Schema.optional(StringArray),
  code_challenge_methods_supported: Schema.optional(StringArray),
  token_endpoint_auth_methods_supported: Schema.optional(StringArray),
  revocation_endpoint: Schema.optional(Schema.String),
  introspection_endpoint: Schema.optional(Schema.String),
  userinfo_endpoint: Schema.optional(Schema.String),
  id_token_signing_alg_values_supported: Schema.optional(StringArray),
}).annotate({ identifier: "OAuthAuthorizationServerMetadata" });
export type OAuthAuthorizationServerMetadata = typeof OAuthAuthorizationServerMetadataSchema.Type;

export type DynamicClientMetadata = {
  readonly client_name?: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types?: readonly string[];
  readonly response_types?: readonly string[];
  readonly token_endpoint_auth_method?:
    | "none"
    | "client_secret_basic"
    | "client_secret_post"
    | "private_key_jwt";
  readonly scope?: string;
  readonly application_type?: "web" | "native";
  readonly client_uri?: string;
  readonly logo_uri?: string;
  readonly contacts?: readonly string[];
  readonly software_id?: string;
  readonly software_version?: string;
  /** Escape hatch for provider-specific extensions; merged last. */
  readonly extra?: Readonly<Record<string, unknown>>;
};

export const OAuthClientInformationSchema = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.optional(Schema.String),
  client_id_issued_at: Schema.optional(Schema.Number),
  client_secret_expires_at: Schema.optional(Schema.Number),
  registration_access_token: Schema.optional(Schema.String),
  registration_client_uri: Schema.optional(Schema.String),
  token_endpoint_auth_method: Schema.optional(Schema.String),
  grant_types: Schema.optional(StringArray),
  response_types: Schema.optional(StringArray),
  redirect_uris: Schema.optional(StringArray),
  client_name: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
}).annotate({ identifier: "OAuthClientInformation" });
export type OAuthClientInformation = typeof OAuthClientInformationSchema.Type;

const decodeResourceMetadataJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OAuthProtectedResourceMetadataSchema),
);
const decodeAuthServerMetadata = Schema.decodeUnknownEffect(OAuthAuthorizationServerMetadataSchema);
const decodeClientInformationJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OAuthClientInformationSchema),
);

export interface DiscoveryRequestOptions {
  /** Injected for tests. Defaults to the platform fetch-backed HttpClient. */
  readonly httpClientLayer?: Layer.Layer<HttpClient.HttpClient>;
  /** Abort the request after this many ms. Default 20000. */
  readonly timeoutMs?: number;
  /** Send `MCP-Protocol-Version: <value>` on every request. Harmless
   *  for non-MCP servers; required by the MCP authorization spec. */
  readonly mcpProtocolVersion?: string;
  /** Credentials needed to reach the protected resource itself. These
   *  are intentionally used only for resource-side probes, never for
   *  authorization-server metadata, DCR, authorization, or token calls. */
  readonly resourceHeaders?: Readonly<Record<string, string>>;
  readonly resourceQueryParams?: Readonly<Record<string, string>>;
}

const MCP_PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

const isLoopbackHttpUrl = (value: string): boolean => {
  // oxlint-disable-next-line executor/no-try-catch-or-throw -- boundary: URL constructor is the platform parser; invalid URLs are not loopback HTTP
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
};

const provideHttpClient = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  options: DiscoveryRequestOptions,
): Effect.Effect<A, E> =>
  effect.pipe(Effect.provide(options.httpClientLayer ?? FetchHttpClient.layer));

const executeText = (
  request: HttpClientRequest.HttpClientRequest,
  options: DiscoveryRequestOptions,
  errorMessage: string,
): Effect.Effect<{ readonly status: number; readonly body: string }, OAuthDiscoveryError> =>
  provideHttpClient(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(request).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(options.timeoutMs ?? OAUTH2_DEFAULT_TIMEOUT_MS),
          orElse: () =>
            Effect.fail(
              new OAuthDiscoveryError({
                message: errorMessage,
                cause: "timeout",
              }),
            ),
        }),
        Effect.mapError((cause) =>
          Predicate.isTagged(cause, "OAuthDiscoveryError")
            ? cause
            : new OAuthDiscoveryError({
                message: errorMessage,
                cause,
              }),
        ),
      );
      const body = yield* response.text.pipe(
        Effect.catch(() => Effect.succeed("")),
        Effect.mapError(
          (cause) =>
            new OAuthDiscoveryError({
              message: `${errorMessage}: response body could not be read`,
              status: response.status,
              cause,
            }),
        ),
      );
      return { status: response.status, body };
    }),
    options,
  );

// ---------------------------------------------------------------------------
// RFC 9728 — Protected Resource Metadata
//
// Not covered by `oauth4webapi`. Hand-rolled probe: try the path-scoped
// well-known first, then the origin-scoped fallback.
// ---------------------------------------------------------------------------

const buildResourceMetadataUrls = (resourceUrl: string): string[] => {
  const url = new URL(resourceUrl);
  const origin = `${url.protocol}//${url.host}`;
  const path = url.pathname.replace(/\/+$/, "");
  const urls: string[] = [];
  if (path && path !== "/") {
    urls.push(`${origin}/.well-known/oauth-protected-resource${path}`);
  }
  urls.push(`${origin}/.well-known/oauth-protected-resource`);
  return urls;
};

const withResourceQueryParams = (
  url: string,
  queryParams: Readonly<Record<string, string>> | undefined,
): string => {
  if (!queryParams || Object.keys(queryParams).length === 0) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(queryParams)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
};

export const discoverProtectedResourceMetadata = (
  resourceUrl: string,
  options: DiscoveryRequestOptions = {},
): Effect.Effect<
  { readonly metadataUrl: string; readonly metadata: OAuthProtectedResourceMetadata } | null,
  OAuthDiscoveryError
> =>
  Effect.gen(function* () {
    for (const url of buildResourceMetadataUrls(resourceUrl)) {
      const requestUrl = withResourceQueryParams(url, options.resourceQueryParams);
      let request = HttpClientRequest.get(requestUrl).pipe(
        HttpClientRequest.setHeader("accept", "application/json"),
      );
      for (const [name, value] of Object.entries(options.resourceHeaders ?? {})) {
        request = HttpClientRequest.setHeader(request, name, value);
      }
      if (options.mcpProtocolVersion) {
        request = HttpClientRequest.setHeader(
          request,
          MCP_PROTOCOL_VERSION_HEADER,
          options.mcpProtocolVersion,
        );
      }

      const result = yield* executeText(
        request,
        options,
        `Failed to fetch protected resource metadata from ${url}`,
      );
      if (result.status === 404 || result.status === 405 || result.body.length === 0) continue;
      if (result.status < 200 || result.status >= 300) {
        return yield* new OAuthDiscoveryError({
          message: `Protected resource metadata returned status ${result.status}`,
          status: result.status,
        });
      }
      const metadata = yield* decodeResourceMetadataJson(result.body).pipe(
        Effect.mapError(
          (err) =>
            new OAuthDiscoveryError({
              message: "Protected resource metadata is malformed",
              cause: err,
            }),
        ),
      );
      return { metadataUrl: url, metadata };
    }
    return null;
  });

// ---------------------------------------------------------------------------
// RFC 8414 + OIDC Discovery — Authorization Server Metadata
//
// Try RFC 8414 (`oauth2`) first and fall back to OIDC Discovery. Keep the
// probing in this module so the whole discovery stack shares the same Effect
// HttpClient boundary and timeout behavior.
// ---------------------------------------------------------------------------

const wellKnownUrlFor = (
  issuerOrigin: string,
  algorithm: "oauth2" | "oidc",
  issuerPath: string,
): string => {
  // Mirrors the library's own well-known composition so the URL we
  // surface matches what was actually fetched.
  const suffix = algorithm === "oauth2" ? "oauth-authorization-server" : "openid-configuration";
  return issuerPath && issuerPath !== "/"
    ? `${issuerOrigin}/.well-known/${suffix}${issuerPath}`
    : `${issuerOrigin}/.well-known/${suffix}`;
};

export const discoverAuthorizationServerMetadata = (
  issuer: string,
  options: DiscoveryRequestOptions = {},
): Effect.Effect<
  {
    readonly metadataUrl: string;
    readonly metadata: OAuthAuthorizationServerMetadata;
  } | null,
  OAuthDiscoveryError
> =>
  Effect.gen(function* () {
    const issuerUrl = new URL(issuer);
    const issuerOrigin = `${issuerUrl.protocol}//${issuerUrl.host}`;
    const issuerPath = issuerUrl.pathname.replace(/\/+$/, "");

    for (const algorithm of ["oauth2", "oidc"] as const) {
      const metadataUrl = wellKnownUrlFor(issuerOrigin, algorithm, issuerPath);
      let request = HttpClientRequest.get(metadataUrl).pipe(
        HttpClientRequest.setHeader("accept", "application/json"),
      );
      if (options.mcpProtocolVersion) {
        request = HttpClientRequest.setHeader(
          request,
          MCP_PROTOCOL_VERSION_HEADER,
          options.mcpProtocolVersion,
        );
      }
      const result = yield* executeText(
        request,
        options,
        `Discovery (${algorithm}) failed for ${issuer}`,
      ).pipe(
        Effect.map((response) => {
          if (response.status === 404 || response.status === 405) return null;
          return response;
        }),
        // If one algorithm fails mid-roundtrip (network, parse, issuer
        // mismatch) we still want to try the other before giving up.
        Effect.result,
      );

      if (Result.isFailure(result)) continue;
      const response = result.success;
      if (response === null) continue;
      if (response.status < 200 || response.status >= 300) continue;

      const raw = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
        response.body,
      ).pipe(
        Effect.mapError(
          (err) =>
            new OAuthDiscoveryError({
              message: "Authorization server metadata is malformed",
              cause: err,
            }),
        ),
      );
      const metadata = yield* decodeAuthServerMetadata(raw).pipe(
        Effect.mapError(
          (err) =>
            new OAuthDiscoveryError({
              message: "Authorization server metadata is malformed",
              cause: err,
            }),
        ),
      );
      return { metadataUrl, metadata };
    }
    return null;
  });

// ---------------------------------------------------------------------------
// RFC 7591 — Dynamic Client Registration
//
// Hand-rolled instead of delegating to oauth4webapi. The library's
// `processDynamicClientRegistrationResponse` requires the AS return
// HTTP 201 Created (RFC 7591 §3.2.1), but Todoist (and others) return
// 200 OK on success. We accept both, and still surface 4xx OAuth error
// envelopes the same way oauth4webapi would.
// ---------------------------------------------------------------------------

export interface RegisterDynamicClientInput {
  readonly registrationEndpoint: string;
  readonly metadata: DynamicClientMetadata;
  readonly initialAccessToken?: string | null;
}

// Internal failure modes — collapsed into `OAuthDiscoveryError` at the
// boundary. Tagged so we can match without `instanceof`.
class DcrErrorBody extends Data.TaggedError("DcrErrorBody")<{
  readonly status: number;
  readonly error: string;
  readonly error_description?: string;
}> {}

class DcrTransport extends Data.TaggedError("DcrTransport")<{
  readonly detail: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

const DcrErrorBodyJson = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
});
const decodeDcrErrorBodyJson = Schema.decodeUnknownOption(Schema.fromJsonString(DcrErrorBodyJson));

const buildDcrBody = (m: DynamicClientMetadata): Record<string, unknown> => {
  const body: Record<string, unknown> = { redirect_uris: [...m.redirect_uris] };
  if (m.client_name !== undefined) body.client_name = m.client_name;
  if (m.grant_types !== undefined) body.grant_types = [...m.grant_types];
  if (m.response_types !== undefined) body.response_types = [...m.response_types];
  if (m.token_endpoint_auth_method !== undefined) {
    body.token_endpoint_auth_method = m.token_endpoint_auth_method;
  }
  if (m.scope !== undefined) body.scope = m.scope;
  if (m.application_type !== undefined) body.application_type = m.application_type;
  if (m.client_uri !== undefined) body.client_uri = m.client_uri;
  if (m.logo_uri !== undefined) body.logo_uri = m.logo_uri;
  if (m.contacts !== undefined) body.contacts = [...m.contacts];
  if (m.software_id !== undefined) body.software_id = m.software_id;
  if (m.software_version !== undefined) body.software_version = m.software_version;
  if (m.extra) for (const [k, v] of Object.entries(m.extra)) body[k] = v;
  return body;
};

const interpretDcrFailure = (status: number, text: string): DcrErrorBody | DcrTransport => {
  // RFC 6749 error envelope: `{error, error_description?}` with 4xx.
  if (status >= 400 && status < 500) {
    const body = text ? decodeDcrErrorBodyJson(text) : null;
    return Option.match(body ?? Option.none(), {
      onNone: () =>
        new DcrTransport({
          detail: `Dynamic Client Registration endpoint returned status ${status}${
            text ? ` — ${text.slice(0, 200)}` : ""
          }`,
          status,
        }),
      onSome: (parsed) =>
        parsed.error.length > 0
          ? new DcrErrorBody({
              status,
              error: parsed.error,
              error_description: parsed.error_description,
            })
          : new DcrTransport({
              detail: `Dynamic Client Registration endpoint returned status ${status}${
                text ? ` — ${text.slice(0, 200)}` : ""
              }`,
              status,
            }),
    });
  }
  return new DcrTransport({
    detail: `Dynamic Client Registration endpoint returned status ${status}${
      text ? ` — ${text.slice(0, 200)}` : ""
    }`,
    status,
  });
};

export const registerDynamicClient = (
  input: RegisterDynamicClientInput,
  options: DiscoveryRequestOptions = {},
): Effect.Effect<OAuthClientInformation, OAuthDiscoveryError> =>
  Effect.gen(function* () {
    const url = new URL(input.registrationEndpoint);
    if (url.protocol !== "https:" && !isLoopbackHttpUrl(input.registrationEndpoint)) {
      return yield* new DcrTransport({
        detail: `registration_endpoint must be HTTPS or a loopback HTTP URL (got ${url.protocol}//${url.host})`,
      });
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (input.initialAccessToken) {
      headers.authorization = `Bearer ${input.initialAccessToken}`;
    }

    let request = HttpClientRequest.post(input.registrationEndpoint).pipe(
      HttpClientRequest.bodyJsonUnsafe(buildDcrBody(input.metadata)),
    );
    for (const [name, value] of Object.entries(headers)) {
      request = HttpClientRequest.setHeader(request, name, value);
    }

    const response = yield* executeText(
      request,
      options,
      "Dynamic Client Registration request failed",
    ).pipe(
      Effect.mapError(
        (cause) =>
          new DcrTransport({
            detail: "Dynamic Client Registration request failed",
            cause,
          }),
      ),
    );

    // Accept both 200 and 201 as success — RFC 7591 mandates 201, but
    // Todoist (and others) return 200 OK with the client information body.
    if (response.status !== 200 && response.status !== 201) {
      return yield* interpretDcrFailure(response.status, response.body);
    }

    return yield* decodeClientInformationJson(response.body).pipe(
      Effect.mapError(
        (err) =>
          new OAuthDiscoveryError({
            message: "Dynamic Client Registration response is malformed",
            cause: err,
          }),
      ),
    );
  }).pipe(
    Effect.catchTags({
      DcrErrorBody: (err) =>
        Effect.fail(
          new OAuthDiscoveryError({
            message: `Dynamic Client Registration failed: ${err.error}${
              err.error_description ? ` — ${err.error_description}` : ""
            }`,
            status: err.status,
            cause: err,
          }),
        ),
      DcrTransport: (err) =>
        Effect.fail(
          new OAuthDiscoveryError({
            message: `Dynamic Client Registration failed: ${err.detail}`,
            status: err.status,
            cause: err.cause ?? err,
          }),
        ),
    }),
  );

// ---------------------------------------------------------------------------
// Convenience: begin the full dynamic flow in one call
// ---------------------------------------------------------------------------

export interface DynamicAuthorizationState {
  readonly resourceMetadata: OAuthProtectedResourceMetadata | null;
  readonly resourceMetadataUrl: string | null;
  readonly authorizationServerUrl: string;
  readonly authorizationServerMetadataUrl: string;
  readonly authorizationServerMetadata: OAuthAuthorizationServerMetadata;
  readonly clientInformation: OAuthClientInformation;
}

export interface DynamicAuthorizationStartResult {
  readonly authorizationUrl: string;
  readonly codeVerifier: string;
  readonly state: DynamicAuthorizationState;
}

export interface BeginDynamicAuthorizationInput {
  readonly endpoint: string;
  readonly redirectUrl: string;
  /** RFC 6749 `state` — callers typically pass a per-session random id. */
  readonly state: string;
  /** Defaults: `redirect_uris=[redirectUrl]`, `token_endpoint_auth_method="none"`
   *  (public client + PKCE). */
  readonly clientMetadata?: Partial<DynamicClientMetadata>;
  /** Scopes to request. Defaults to `scopes_supported`; omitted if
   *  neither is set. */
  readonly scopes?: readonly string[];
  /** Pre-existing state from a previous flow. When provided, the
   *  matching discovery / DCR step is skipped so multi-user sign-ins
   *  against the same source don't re-pay those costs. */
  readonly previousState?: {
    readonly authorizationServerUrl?: string | null;
    readonly authorizationServerMetadata?: OAuthAuthorizationServerMetadata | null;
    readonly authorizationServerMetadataUrl?: string | null;
    readonly resourceMetadata?: OAuthProtectedResourceMetadata | null;
    readonly resourceMetadataUrl?: string | null;
    readonly clientInformation?: OAuthClientInformation | null;
  };
}

export const beginDynamicAuthorization = (
  input: BeginDynamicAuthorizationInput,
  options: DiscoveryRequestOptions = {},
): Effect.Effect<DynamicAuthorizationStartResult, OAuthDiscoveryError> =>
  Effect.gen(function* () {
    const prior = input.previousState ?? {};

    // Skip the resource-metadata probe when we already know (or can
    // derive) the authorization server URL. Saves two round-trips for
    // every second-and-later user signing into the same source.
    const canSkipResourceDiscovery =
      prior.resourceMetadata !== undefined ||
      !!prior.authorizationServerUrl ||
      !!prior.authorizationServerMetadata;

    const resource = canSkipResourceDiscovery
      ? prior.resourceMetadata
        ? {
            metadata: prior.resourceMetadata,
            metadataUrl: prior.resourceMetadataUrl ?? null,
          }
        : null
      : yield* discoverProtectedResourceMetadata(input.endpoint, options);

    const authorizationServerUrl = (() => {
      if (prior.authorizationServerUrl) return prior.authorizationServerUrl;
      const fromResource = resource && resource.metadata.authorization_servers?.[0];
      if (fromResource) return fromResource;
      const u = new URL(input.endpoint);
      return `${u.protocol}//${u.host}`;
    })();

    const authServer =
      prior.authorizationServerMetadata && prior.authorizationServerMetadataUrl
        ? {
            metadata: prior.authorizationServerMetadata,
            metadataUrl: prior.authorizationServerMetadataUrl,
          }
        : yield* discoverAuthorizationServerMetadata(authorizationServerUrl, options);

    if (!authServer) {
      return yield* new OAuthDiscoveryError({
        message: `No OAuth authorization server metadata at ${authorizationServerUrl}`,
      });
    }

    const pkceMethods = authServer.metadata.code_challenge_methods_supported ?? [];
    if (pkceMethods.length > 0 && !pkceMethods.includes("S256")) {
      return yield* new OAuthDiscoveryError({
        message: `Authorization server does not support PKCE S256 (advertised: ${pkceMethods.join(", ")})`,
      });
    }

    const responseTypes = authServer.metadata.response_types_supported ?? [];
    if (responseTypes.length > 0 && !responseTypes.includes("code")) {
      return yield* new OAuthDiscoveryError({
        message: `Authorization server does not support response_type=code (advertised: ${responseTypes.join(", ")})`,
      });
    }

    const scopes = input.scopes ?? authServer.metadata.scopes_supported ?? [];

    const baseClientMetadata: DynamicClientMetadata = {
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: "Executor",
      ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
      ...(input.clientMetadata ?? {}),
      redirect_uris: input.clientMetadata?.redirect_uris ?? [input.redirectUrl],
    };

    const clientInformation =
      prior.clientInformation ??
      (yield* (() => {
        const reg = authServer.metadata.registration_endpoint;
        if (!reg) {
          return Effect.fail(
            new OAuthDiscoveryError({
              message:
                "Authorization server does not advertise registration_endpoint — cannot auto-register a client",
            }),
          );
        }
        return registerDynamicClient(
          { registrationEndpoint: reg, metadata: baseClientMetadata },
          options,
        );
      })());

    const codeVerifier = createPkceCodeVerifier();
    const codeChallenge = yield* Effect.promise(() => createPkceCodeChallenge(codeVerifier));

    const authorizationUrl = buildAuthorizationUrl({
      authorizationUrl: authServer.metadata.authorization_endpoint,
      clientId: clientInformation.client_id,
      redirectUrl: input.redirectUrl,
      scopes,
      state: input.state,
      codeChallenge,
    });

    return {
      authorizationUrl,
      codeVerifier,
      state: {
        resourceMetadata: resource?.metadata ?? null,
        resourceMetadataUrl: resource?.metadataUrl ?? null,
        authorizationServerUrl,
        authorizationServerMetadataUrl: authServer.metadataUrl,
        authorizationServerMetadata: authServer.metadata,
        clientInformation,
      },
    };
  });

export { createPkceCodeChallenge };
