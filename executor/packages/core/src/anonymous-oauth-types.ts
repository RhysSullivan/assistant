import type { JWK } from "jose";

export interface AnonOAuthClientRegistration {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created_at: number;
}

export interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  actorId: string;
  tokenClaims?: Record<string, unknown>;
  expiresAt: number;
  createdAt: number;
}

export const RESERVED_JWT_CLAIMS = new Set([
  "iss",
  "sub",
  "aud",
  "exp",
  "nbf",
  "iat",
  "jti",
]);

export function sanitizeTokenClaims(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!input) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_JWT_CLAIMS.has(key)) continue;
    if (value === undefined) continue;
    sanitized[key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export interface AnonymousAuthorizeOptions {
  actorId?: string;
  tokenClaims?: Record<string, unknown>;
}

export interface AnonOAuthConfig {
  issuer: string;
  accessTokenTtlSeconds?: number;
  codeExpirySeconds?: number;
  maxPendingCodes?: number;
  storage: OAuthStorage;
}

export interface StoredSigningKey {
  keyId: string;
  algorithm: string;
  privateKeyJwk: JWK;
  publicKeyJwk: JWK;
}

export interface OAuthStorage {
  getActiveSigningKey(): Promise<StoredSigningKey | null>;
  storeSigningKey(key: StoredSigningKey): Promise<void>;
  registerClient(registration: AnonOAuthClientRegistration): Promise<AnonOAuthClientRegistration>;
  getClient(clientId: string): Promise<AnonOAuthClientRegistration | null>;
  storeAuthorizationCode(code: AuthorizationCode): Promise<void>;
  consumeAuthorizationCode(code: string): Promise<AuthorizationCode | null>;
  purgeExpiredAuthorizationCodes(now: number): Promise<number>;
  countAuthorizationCodes(): Promise<number>;
}
