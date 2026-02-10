import { describe, test, expect, beforeAll } from "bun:test";
import {
  AnonymousOAuthServer,
  OAuthBadRequest,
  computeS256Challenge,
} from "./anonymous-oauth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createServer(issuer = "http://localhost:3003"): AnonymousOAuthServer {
  return new AnonymousOAuthServer({ issuer });
}

/** Generate a random PKCE code_verifier (43–128 chars, unreserved). */
function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function registerAndAuthorize(
  server: AnonymousOAuthServer,
  redirectUri = "http://localhost:9999/callback",
) {
  const client = server.registerClient({
    redirect_uris: [redirectUri],
    client_name: "test-client",
  });

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeS256Challenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: "test-state-123",
  });

  const { redirectTo } = server.authorize(params);
  const redirectUrl = new URL(redirectTo);
  const code = redirectUrl.searchParams.get("code")!;

  return { client, codeVerifier, codeChallenge, code, redirectUrl, redirectUri };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnonymousOAuthServer", () => {
  let server: AnonymousOAuthServer;

  beforeAll(async () => {
    server = createServer();
    await server.init();
  });

  // ── Metadata ────────────────────────────────────────────────────────────

  describe("getMetadata", () => {
    test("returns RFC 8414 compliant metadata", () => {
      const metadata = server.getMetadata();
      expect(metadata.issuer).toBe("http://localhost:3003");
      expect(metadata.authorization_endpoint).toBe("http://localhost:3003/authorize");
      expect(metadata.token_endpoint).toBe("http://localhost:3003/token");
      expect(metadata.registration_endpoint).toBe("http://localhost:3003/register");
      expect(metadata.jwks_uri).toBe("http://localhost:3003/oauth2/jwks");
      expect(metadata.response_types_supported).toEqual(["code"]);
      expect(metadata.grant_types_supported).toEqual(["authorization_code"]);
      expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
      expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    });

    test("strips trailing slashes from issuer", async () => {
      const s = createServer("http://localhost:3003///");
      await s.init();
      expect(s.getMetadata().issuer).toBe("http://localhost:3003");
    });
  });

  // ── JWKS ────────────────────────────────────────────────────────────────

  describe("getJwks", () => {
    test("returns a JWKS with one RSA public key", () => {
      const jwks = server.getJwks();
      expect(jwks.keys).toHaveLength(1);
      const key = jwks.keys[0];
      expect(key.kty).toBe("RSA");
      expect(key.use).toBe("sig");
      expect(key.alg).toBe("RS256");
      expect(key.kid).toBeDefined();
      // Public key should not include private components
      expect(key.d).toBeUndefined();
    });
  });

  // ── Client Registration ─────────────────────────────────────────────────

  describe("registerClient", () => {
    test("registers a client and returns a client_id", () => {
      const reg = server.registerClient({
        redirect_uris: ["http://localhost:9999/callback"],
        client_name: "my-mcp-client",
      });

      expect(reg.client_id).toStartWith("anon_client_");
      expect(reg.client_name).toBe("my-mcp-client");
      expect(reg.redirect_uris).toEqual(["http://localhost:9999/callback"]);
      expect(reg.created_at).toBeGreaterThan(0);
    });

    test("rejects registration without redirect_uris", () => {
      expect(() => server.registerClient({} as any)).toThrow(OAuthBadRequest);
    });

    test("rejects registration with empty redirect_uris", () => {
      expect(() => server.registerClient({ redirect_uris: [] })).toThrow(OAuthBadRequest);
    });

    test("rejects registration with invalid redirect_uri entries", () => {
      expect(() => server.registerClient({ redirect_uris: [""] })).toThrow(OAuthBadRequest);
    });

    test("increments client count", () => {
      const before = server.getClientCount();
      server.registerClient({ redirect_uris: ["http://example.com/cb"] });
      expect(server.getClientCount()).toBe(before + 1);
    });
  });

  // ── Authorization ───────────────────────────────────────────────────────

  describe("authorize", () => {
    test("returns redirect with code and state", async () => {
      const { redirectUrl } = await registerAndAuthorize(server);
      expect(redirectUrl.searchParams.get("code")).toBeTruthy();
      expect(redirectUrl.searchParams.get("state")).toBe("test-state-123");
      expect(redirectUrl.origin).toBe("http://localhost:9999");
      expect(redirectUrl.pathname).toBe("/callback");
    });

    test("rejects unsupported response_type", () => {
      const client = server.registerClient({
        redirect_uris: ["http://localhost/cb"],
      });
      const params = new URLSearchParams({
        response_type: "token",
        client_id: client.client_id,
        redirect_uri: "http://localhost/cb",
        code_challenge: "abc",
        code_challenge_method: "S256",
      });
      expect(() => server.authorize(params)).toThrow("response_type must be 'code'");
    });

    test("rejects unknown client_id", () => {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: "unknown",
        redirect_uri: "http://localhost/cb",
        code_challenge: "abc",
        code_challenge_method: "S256",
      });
      expect(() => server.authorize(params)).toThrow("Unknown client_id");
    });

    test("rejects mismatched redirect_uri", () => {
      const client = server.registerClient({
        redirect_uris: ["http://localhost/cb"],
      });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "http://evil.com/cb",
        code_challenge: "abc",
        code_challenge_method: "S256",
      });
      expect(() => server.authorize(params)).toThrow("redirect_uri does not match");
    });

    test("rejects missing PKCE challenge", () => {
      const client = server.registerClient({
        redirect_uris: ["http://localhost/cb"],
      });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "http://localhost/cb",
      });
      expect(() => server.authorize(params)).toThrow("PKCE S256 code_challenge is required");
    });

    test("rejects non-S256 PKCE method", () => {
      const client = server.registerClient({
        redirect_uris: ["http://localhost/cb"],
      });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "http://localhost/cb",
        code_challenge: "abc",
        code_challenge_method: "plain",
      });
      expect(() => server.authorize(params)).toThrow("PKCE S256 code_challenge is required");
    });
  });

  // ── Token Exchange ──────────────────────────────────────────────────────

  describe("exchangeToken", () => {
    test("exchanges code for a valid JWT access token", async () => {
      const { code, codeVerifier, redirectUri } = await registerAndAuthorize(server);

      const result = await server.exchangeToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      );

      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBeGreaterThan(0);
      expect(result.access_token).toBeTruthy();

      // Verify the token is a valid JWT we can decode
      const verified = await server.verifyToken(result.access_token);
      expect(verified).not.toBeNull();
      expect(verified!.sub).toStartWith("anon_");
      expect(verified!.provider).toBe("anonymous");
    });

    test("code is single-use", async () => {
      const { code, codeVerifier, redirectUri } = await registerAndAuthorize(server);

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

      // First exchange succeeds
      await server.exchangeToken(body);

      // Second exchange fails
      await expect(server.exchangeToken(body)).rejects.toThrow("invalid or expired code");
    });

    test("rejects wrong grant_type", async () => {
      await expect(
        server.exchangeToken(new URLSearchParams({ grant_type: "client_credentials" })),
      ).rejects.toThrow("grant_type must be authorization_code");
    });

    test("rejects expired code", async () => {
      // Create server with very short code expiry
      const shortServer = new AnonymousOAuthServer({
        issuer: "http://localhost:3003",
        codeExpirySeconds: 0, // expires immediately
      });
      await shortServer.init();

      const { code, codeVerifier, redirectUri } = await registerAndAuthorize(shortServer);

      // Wait a tick for the code to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      await expect(
        shortServer.exchangeToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          }),
        ),
      ).rejects.toThrow("authorization code has expired");
    });

    test("rejects wrong redirect_uri", async () => {
      const { code, codeVerifier } = await registerAndAuthorize(server);

      await expect(
        server.exchangeToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: "http://evil.com/cb",
            code_verifier: codeVerifier,
          }),
        ),
      ).rejects.toThrow("redirect_uri mismatch");
    });

    test("rejects wrong code_verifier", async () => {
      const { code, redirectUri } = await registerAndAuthorize(server);

      await expect(
        server.exchangeToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            code_verifier: "wrong-verifier-value",
          }),
        ),
      ).rejects.toThrow("code_verifier does not match code_challenge");
    });

    test("rejects missing code_verifier", async () => {
      const { code, redirectUri } = await registerAndAuthorize(server);

      await expect(
        server.exchangeToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        ),
      ).rejects.toThrow("code_verifier is required");
    });
  });

  // ── Token Verification ──────────────────────────────────────────────────

  describe("verifyToken", () => {
    test("verifies a self-issued token", async () => {
      const { code, codeVerifier, redirectUri } = await registerAndAuthorize(server);
      const { access_token } = await server.exchangeToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      );

      const result = await server.verifyToken(access_token);
      expect(result).not.toBeNull();
      expect(result!.sub).toStartWith("anon_");
      expect(result!.provider).toBe("anonymous");
    });

    test("rejects garbage tokens", async () => {
      const result = await server.verifyToken("not.a.jwt");
      expect(result).toBeNull();
    });

    test("rejects tokens from a different server", async () => {
      const otherServer = createServer("http://other-server:4000");
      await otherServer.init();

      const { code, codeVerifier, redirectUri } = await registerAndAuthorize(otherServer);
      const { access_token } = await otherServer.exchangeToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      );

      // Our server should reject a token from the other server
      const result = await server.verifyToken(access_token);
      expect(result).toBeNull();
    });
  });

  // ── PKCE S256 ───────────────────────────────────────────────────────────

  describe("computeS256Challenge", () => {
    test("produces a deterministic base64url-encoded SHA-256 hash", async () => {
      const challenge1 = await computeS256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
      const challenge2 = await computeS256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
      expect(challenge1).toBe(challenge2);
      // Known value from RFC 7636 Appendix B
      expect(challenge1).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    });
  });

  // ── Code Purging ────────────────────────────────────────────────────────

  describe("purgeExpiredCodes", () => {
    test("removes expired codes", async () => {
      const s = new AnonymousOAuthServer({
        issuer: "http://localhost:3003",
        codeExpirySeconds: 0,
      });
      await s.init();

      // Generate some codes
      await registerAndAuthorize(s);
      await registerAndAuthorize(s);
      expect(s.getCodeCount()).toBe(2);

      // Wait for them to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const purged = s.purgeExpiredCodes();
      expect(purged).toBe(2);
      expect(s.getCodeCount()).toBe(0);
    });
  });

  // ── Each authorize creates a unique actor ───────────────────────────────

  describe("unique anonymous identities", () => {
    test("each authorization produces a different actor sub", async () => {
      const subs = new Set<string>();

      for (let i = 0; i < 5; i++) {
        const { code, codeVerifier, redirectUri } = await registerAndAuthorize(server);
        const { access_token } = await server.exchangeToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          }),
        );
        const verified = await server.verifyToken(access_token);
        subs.add(verified!.sub);
      }

      expect(subs.size).toBe(5);
    });
  });
});
