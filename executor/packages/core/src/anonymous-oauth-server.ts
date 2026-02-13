import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type CryptoKey as JoseCryptoKey,
  type JWK,
} from "jose";
import { OAuthBadRequest } from "./anonymous-oauth-errors";
import { computeS256Challenge } from "./anonymous-oauth-pkce";
import type {
  AnonOAuthClientRegistration,
  AnonOAuthConfig,
  AnonymousAuthorizeOptions,
  OAuthStorage,
} from "./anonymous-oauth-types";
import { RESERVED_JWT_CLAIMS, sanitizeTokenClaims } from "./anonymous-oauth-types";

export class AnonymousOAuthServer {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTokenTtlSeconds: number;
  private readonly codeExpirySeconds: number;
  private readonly maxPendingCodes: number;
  private readonly storage: OAuthStorage;

  private privateKey!: JoseCryptoKey;
  private publicJwk!: JWK;
  private keyId!: string;

  constructor(config: AnonOAuthConfig) {
    this.issuer = config.issuer.replace(/\/+$/, "");
    this.audience = `${this.issuer}/mcp`;
    this.accessTokenTtlSeconds = config.accessTokenTtlSeconds ?? 24 * 60 * 60;
    this.codeExpirySeconds = config.codeExpirySeconds ?? 120;
    this.maxPendingCodes = config.maxPendingCodes ?? 10_000;
    this.storage = config.storage;
  }

  async init(): Promise<void> {
    const existing = await this.storage.getActiveSigningKey();

    if (existing) {
      this.keyId = existing.keyId;
      this.publicJwk = { ...existing.publicKeyJwk, kid: this.keyId, use: "sig", alg: existing.algorithm };
      this.privateKey = await importJWK(existing.privateKeyJwk, existing.algorithm) as JoseCryptoKey;
    } else {
      const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
      this.privateKey = privateKey;
      this.keyId = `anon_key_${crypto.randomUUID().slice(0, 8)}`;

      const publicJwk = await exportJWK(publicKey);
      this.publicJwk = { ...publicJwk, kid: this.keyId, use: "sig", alg: "RS256" };

      const privateKeyJwk = await exportJWK(privateKey);

      await this.storage.storeSigningKey({
        keyId: this.keyId,
        algorithm: "RS256",
        privateKeyJwk,
        publicKeyJwk: publicJwk,
      });
    }
  }

  async initWithKeys(privateKey: JoseCryptoKey, publicJwk: JWK): Promise<void> {
    this.privateKey = privateKey;
    this.keyId = publicJwk.kid ?? `anon_key_${crypto.randomUUID().slice(0, 8)}`;
    this.publicJwk = { ...publicJwk, kid: this.keyId, use: "sig", alg: "RS256" };
  }

  getMetadata(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      registration_endpoint: `${this.issuer}/register`,
      jwks_uri: `${this.issuer}/oauth2/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [],
    };
  }

  getJwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }

  async registerClient(body: {
    redirect_uris?: string[];
    client_name?: string;
  }): Promise<AnonOAuthClientRegistration> {
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      throw new OAuthBadRequest("redirect_uris is required and must be non-empty");
    }

    for (const uri of redirectUris) {
      if (typeof uri !== "string" || uri.length === 0) {
        throw new OAuthBadRequest("Each redirect_uri must be a non-empty string");
      }
      try {
        new URL(uri);
      } catch {
        throw new OAuthBadRequest(`Invalid redirect_uri: ${uri}`);
      }
    }

    const clientId = `anon_client_${crypto.randomUUID()}`;
    const registration: AnonOAuthClientRegistration = {
      client_id: clientId,
      client_name: typeof body.client_name === "string" ? body.client_name : undefined,
      redirect_uris: redirectUris,
      created_at: Date.now(),
    };

    return await this.storage.registerClient(registration);
  }

  async authorize(params: URLSearchParams, options?: AnonymousAuthorizeOptions): Promise<{ redirectTo: string }> {
    const responseType = params.get("response_type");
    if (responseType !== "code") {
      throw new OAuthBadRequest("response_type must be 'code'");
    }

    const clientId = params.get("client_id");
    if (!clientId) {
      throw new OAuthBadRequest("client_id is required");
    }

    const client = await this.storage.getClient(clientId);
    if (!client) {
      throw new OAuthBadRequest("Unknown client_id");
    }

    const redirectUri = params.get("redirect_uri");
    if (!redirectUri) {
      throw new OAuthBadRequest("redirect_uri is required");
    }
    if (!client.redirect_uris.includes(redirectUri)) {
      throw new OAuthBadRequest("redirect_uri does not match registered URIs");
    }

    const codeChallenge = params.get("code_challenge");
    const codeChallengeMethod = params.get("code_challenge_method");
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      throw new OAuthBadRequest("PKCE S256 code_challenge is required");
    }

    const requestedActorId = options?.actorId?.trim();
    const actorId = requestedActorId && requestedActorId.length > 0
      ? requestedActorId
      : `anon_${crypto.randomUUID()}`;

    if (await this.storage.countAuthorizationCodes() >= this.maxPendingCodes) {
      await this.storage.purgeExpiredAuthorizationCodes(Date.now());
      if (await this.storage.countAuthorizationCodes() >= this.maxPendingCodes) {
        throw new OAuthBadRequest("Too many pending authorization requests — try again later");
      }
    }

    const code = crypto.randomUUID();
    await this.storage.storeAuthorizationCode({
      code,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      actorId,
      tokenClaims: sanitizeTokenClaims(options?.tokenClaims),
      expiresAt: Date.now() + this.codeExpirySeconds * 1000,
      createdAt: Date.now(),
    });

    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    const state = params.get("state");
    if (state) {
      redirect.searchParams.set("state", state);
    }

    return { redirectTo: redirect.toString() };
  }

  async exchangeToken(body: URLSearchParams): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    const grantType = body.get("grant_type");
    if (grantType !== "authorization_code") {
      throw new OAuthBadRequest("grant_type must be authorization_code");
    }

    const codeValue = body.get("code");
    if (!codeValue) {
      throw new OAuthBadRequest("code is required");
    }

    const storedCode = await this.storage.consumeAuthorizationCode(codeValue);
    if (!storedCode) {
      throw new OAuthBadRequest("invalid or expired code");
    }

    if (Date.now() > storedCode.expiresAt) {
      throw new OAuthBadRequest("authorization code has expired");
    }

    const clientId = body.get("client_id");
    if (clientId !== storedCode.clientId) {
      throw new OAuthBadRequest("client_id mismatch");
    }

    const redirectUri = body.get("redirect_uri");
    if (redirectUri !== storedCode.redirectUri) {
      throw new OAuthBadRequest("redirect_uri mismatch");
    }

    const codeVerifier = body.get("code_verifier");
    if (!codeVerifier) {
      throw new OAuthBadRequest("code_verifier is required");
    }

    const expectedChallenge = await computeS256Challenge(codeVerifier);
    if (expectedChallenge !== storedCode.codeChallenge) {
      throw new OAuthBadRequest("code_verifier does not match code_challenge");
    }

    const accessTokenClaims = {
      provider: "anonymous",
      ...(storedCode.tokenClaims ?? {}),
    };

    const accessToken = await new SignJWT(accessTokenClaims)
      .setProtectedHeader({ alg: "RS256", kid: this.keyId })
      .setSubject(storedCode.actorId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTokenTtlSeconds}s`)
      .setJti(crypto.randomUUID())
      .sign(this.privateKey);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.accessTokenTtlSeconds,
    };
  }

  async verifyToken(
    token: string,
  ): Promise<{ sub: string; provider: string; claims: Record<string, unknown> } | null> {
    try {
      const { payload } = await jwtVerify(token, createLocalJWKSet({ keys: [this.publicJwk] }), {
        issuer: this.issuer,
        audience: this.audience,
      });

      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        return null;
      }

      return {
        sub: payload.sub,
        provider: typeof payload.provider === "string" ? payload.provider : "anonymous",
        claims: Object.fromEntries(
          Object.entries(payload).filter(([key]) => !RESERVED_JWT_CLAIMS.has(key) && key !== "sub"),
        ),
      };
    } catch {
      return null;
    }
  }

  getIssuer(): string {
    return this.issuer;
  }

  async getCodeCount(): Promise<number> {
    return await this.storage.countAuthorizationCodes();
  }

  async purgeExpiredCodes(): Promise<number> {
    return await this.storage.purgeExpiredAuthorizationCodes(Date.now());
  }
}
