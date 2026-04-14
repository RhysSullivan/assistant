// ---------------------------------------------------------------------------
// @executor/plugin-oauth2 — generic OAuth 2.0 helpers
//
// Pure helpers for building authorization URLs, exchanging codes, and
// refreshing tokens against a standards-compliant OAuth 2.0 token endpoint.
// Plugins (google-discovery, openapi, ...) wrap these with their own
// session storage, secret management, and onboarding UI.
//
// Every public helper is intentionally provider-agnostic. Provider-specific
// query parameters (Google's `access_type=offline`, `prompt=consent`, etc.)
// are passed via the `extraParams` escape hatch so callers don't lose
// fidelity when switching from a hand-rolled implementation.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "node:crypto";

import { Data, Effect } from "effect";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OAuth2Error extends Data.TaggedError("OAuth2Error")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Token response shape (RFC 6749 §5.1)
// ---------------------------------------------------------------------------

export type OAuth2TokenResponse = {
  readonly access_token: string;
  readonly token_type?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Refresh tokens this many ms before expiry to avoid mid-request expiration. */
export const OAUTH2_REFRESH_SKEW_MS = 60_000;

/** Default token-endpoint timeout. */
export const OAUTH2_DEFAULT_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

const encodeBase64Url = (input: Buffer): string =>
  input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/** Generate a 48-byte (64-char base64url) PKCE code verifier. */
export const createPkceCodeVerifier = (): string => encodeBase64Url(randomBytes(48));

/** Compute the S256 code challenge for a given verifier. */
export const createPkceCodeChallenge = (verifier: string): string =>
  encodeBase64Url(createHash("sha256").update(verifier).digest());

// ---------------------------------------------------------------------------
// Authorization URL builder
// ---------------------------------------------------------------------------

export type BuildAuthorizationUrlInput = {
  readonly authorizationUrl: string;
  readonly clientId: string;
  readonly redirectUrl: string;
  readonly scopes: readonly string[];
  readonly state: string;
  readonly codeVerifier: string;
  /** Separator between scopes. RFC 6749 says space; some providers use comma. */
  readonly scopeSeparator?: string;
  /**
   * Provider-specific extra params (e.g. Google's `access_type=offline`,
   * `prompt=consent`, `include_granted_scopes=true`). Merged AFTER the
   * standard params so callers can override if absolutely necessary.
   */
  readonly extraParams?: Readonly<Record<string, string>>;
};

export const buildAuthorizationUrl = (input: BuildAuthorizationUrlInput): string => {
  const url = new URL(input.authorizationUrl);
  const separator = input.scopeSeparator ?? " ";
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(separator));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", createPkceCodeChallenge(input.codeVerifier));
  if (input.extraParams) {
    for (const [k, v] of Object.entries(input.extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
};

// ---------------------------------------------------------------------------
// Token endpoint response parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Response from a token endpoint into an `OAuth2TokenResponse`.
 *
 * Handles, in order, the failure modes we have seen in the wild:
 *   1. Non-JSON bodies (HTML error pages from misconfigured proxies / 5xx)
 *   2. JSON arrays / primitives instead of an object
 *   3. RFC 6749 error responses (`error_description` → `error` → `status N`)
 *   4. 200 responses with empty / missing `access_token`
 *   5. `expires_in` returned as a string instead of a number (Azure et al.)
 */
export const decodeTokenResponse = async (response: Response): Promise<OAuth2TokenResponse> => {
  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`OAuth token endpoint returned non-JSON response (${response.status})`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`OAuth token endpoint returned invalid JSON payload (${response.status})`);
  }

  const record = parsed as Record<string, unknown>;
  const accessToken =
    typeof record.access_token === "string" && record.access_token.length > 0
      ? record.access_token
      : null;

  if (!response.ok) {
    const description =
      typeof record.error_description === "string"
        ? record.error_description
        : typeof record.error === "string"
          ? record.error
          : `status ${response.status}`;
    throw new Error(`OAuth token exchange failed: ${description}`);
  }

  if (accessToken === null) {
    throw new Error("OAuth token endpoint did not return an access_token");
  }

  return {
    access_token: accessToken,
    token_type: typeof record.token_type === "string" ? record.token_type : undefined,
    refresh_token: typeof record.refresh_token === "string" ? record.refresh_token : undefined,
    expires_in:
      typeof record.expires_in === "number"
        ? record.expires_in
        : typeof record.expires_in === "string"
          ? Number(record.expires_in)
          : undefined,
    scope: typeof record.scope === "string" ? record.scope : undefined,
  };
};

// ---------------------------------------------------------------------------
// Token endpoint POST
// ---------------------------------------------------------------------------

export type ClientAuthMethod = "body" | "basic";

const buildClientAuthHeaders = (
  clientId: string,
  clientSecret: string | null | undefined,
  method: ClientAuthMethod,
): Record<string, string> => {
  if (method !== "basic" || !clientSecret) return {};
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return { authorization: `Basic ${encoded}` };
};

const applyClientAuthBody = (
  body: URLSearchParams,
  clientId: string,
  clientSecret: string | null | undefined,
  method: ClientAuthMethod,
): void => {
  if (method === "basic") return;
  body.set("client_id", clientId);
  if (clientSecret) body.set("client_secret", clientSecret);
};

const postToTokenEndpoint = (input: {
  readonly tokenUrl: string;
  readonly body: URLSearchParams;
  readonly extraHeaders: Record<string, string>;
  readonly timeoutMs: number;
}): Effect.Effect<OAuth2TokenResponse, OAuth2Error> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(input.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          ...input.extraHeaders,
        },
        body: input.body,
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      return decodeTokenResponse(response);
    },
    catch: (cause) =>
      new OAuth2Error({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

// ---------------------------------------------------------------------------
// Exchange authorization code → tokens
// ---------------------------------------------------------------------------

export type ExchangeAuthorizationCodeInput = {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string | null;
  readonly redirectUrl: string;
  readonly codeVerifier: string;
  readonly code: string;
  /** "body" (default) sends client creds in the form body; "basic" uses HTTP Basic. */
  readonly clientAuth?: ClientAuthMethod;
  readonly timeoutMs?: number;
};

export const exchangeAuthorizationCode = (
  input: ExchangeAuthorizationCodeInput,
): Effect.Effect<OAuth2TokenResponse, OAuth2Error> => {
  const clientAuth = input.clientAuth ?? "body";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: input.redirectUrl,
    code_verifier: input.codeVerifier,
    code: input.code,
  });
  applyClientAuthBody(body, input.clientId, input.clientSecret, clientAuth);
  return postToTokenEndpoint({
    tokenUrl: input.tokenUrl,
    body,
    extraHeaders: buildClientAuthHeaders(input.clientId, input.clientSecret, clientAuth),
    timeoutMs: input.timeoutMs ?? OAUTH2_DEFAULT_TIMEOUT_MS,
  });
};

// ---------------------------------------------------------------------------
// Refresh access token
// ---------------------------------------------------------------------------

export type RefreshAccessTokenInput = {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string | null;
  readonly refreshToken: string;
  readonly scopes?: readonly string[];
  readonly scopeSeparator?: string;
  readonly clientAuth?: ClientAuthMethod;
  readonly timeoutMs?: number;
};

export const refreshAccessToken = (
  input: RefreshAccessTokenInput,
): Effect.Effect<OAuth2TokenResponse, OAuth2Error> => {
  const clientAuth = input.clientAuth ?? "body";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  applyClientAuthBody(body, input.clientId, input.clientSecret, clientAuth);
  if (input.scopes && input.scopes.length > 0) {
    body.set("scope", input.scopes.join(input.scopeSeparator ?? " "));
  }
  return postToTokenEndpoint({
    tokenUrl: input.tokenUrl,
    body,
    extraHeaders: buildClientAuthHeaders(input.clientId, input.clientSecret, clientAuth),
    timeoutMs: input.timeoutMs ?? OAUTH2_DEFAULT_TIMEOUT_MS,
  });
};

// ---------------------------------------------------------------------------
// Refresh-needed predicate
// ---------------------------------------------------------------------------

/**
 * Returns true iff the current time is within `OAUTH2_REFRESH_SKEW_MS` of
 * `expiresAt`. A null `expiresAt` (server didn't return `expires_in`) means
 * we cannot proactively refresh — callers should fall back to reactive
 * refresh on 401 responses.
 */
export const shouldRefreshToken = (input: {
  readonly expiresAt: number | null;
  readonly now?: number;
  readonly skewMs?: number;
}): boolean => {
  if (input.expiresAt === null) return false;
  const now = input.now ?? Date.now();
  const skew = input.skewMs ?? OAUTH2_REFRESH_SKEW_MS;
  return input.expiresAt <= now + skew;
};
