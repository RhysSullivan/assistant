import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import { appendDeleteCookie, appendSetCookie, readCookie } from "@/lib/http/cookies";

const anonymousAuthAudience = "executor-anonymous";
const anonymousAuthKeyId = "executor-anonymous-es256";
const anonymousAuthTokenTtlSeconds = 60 * 60 * 24 * 7;
const anonymousAuthCookieName = "executor_anonymous_auth";
const anonymousAuthCookieVersion = 1;
const tokenRefreshSkewMs = 60_000;
const configQueryTimeoutMs = 2_000;

const issueAnonymousTokenRequestSchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  forceRefresh: z.boolean().optional(),
}).partial();

const anonymousAuthCookieSchema = z.object({
  version: z.literal(anonymousAuthCookieVersion),
  accessToken: z.string().min(1),
  accountId: z.string().min(1),
  expiresAtMs: z.number().finite(),
});

type AnonymousAuthCookiePayload = z.infer<typeof anonymousAuthCookieSchema>;

function trimOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizePem(value: string | undefined): string | null {
  const raw = trimOrNull(value);
  if (!raw) {
    return null;
  }
  return raw.replace(/\\n/g, "\n");
}

function toSiteUrl(raw?: string): string | null {
  const trimmed = trimOrNull(raw);
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.endsWith(".convex.cloud")) {
      parsed.hostname = parsed.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveIssuer(): string | null {
  return toSiteUrl(
    process.env.ANONYMOUS_AUTH_ISSUER
      ?? process.env.EXECUTOR_WEB_CONVEX_SITE_URL
      ?? process.env.CONVEX_SITE_URL
      ?? process.env.EXECUTOR_WEB_CONVEX_URL
      ?? process.env.CONVEX_URL
      ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL
      ?? process.env.NEXT_PUBLIC_CONVEX_URL,
  );
}

function resolveConvexUrl(): string | null {
  return trimOrNull(
    process.env.EXECUTOR_WEB_CONVEX_URL
      ?? process.env.CONVEX_URL
      ?? process.env.NEXT_PUBLIC_CONVEX_URL,
  );
}

async function resolveIssuerFromBackend(): Promise<string | null> {
  const convexUrl = resolveConvexUrl();
  if (!convexUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configQueryTimeoutMs);
  try {
    const response = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "app:getClientConfig",
        args: {},
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const parsed = z.object({
      status: z.literal("success"),
      value: z.object({
        anonymousAuthIssuer: z.string().trim().min(1).nullable().optional(),
      }).optional(),
    }).safeParse(await response.json());

    if (!parsed.success) {
      return null;
    }

    return toSiteUrl(parsed.data.value?.anonymousAuthIssuer ?? undefined);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseTokenTtlSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : anonymousAuthTokenTtlSeconds;
}

function parseIssueRequestBody(raw: unknown): z.infer<typeof issueAnonymousTokenRequestSchema> {
  const parsed = issueAnonymousTokenRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid anonymous token request payload");
  }
  return parsed.data;
}

function encodeAnonymousAuthCookie(payload: AnonymousAuthCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeAnonymousAuthCookie(raw: string): AnonymousAuthCookiePayload | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    const payload = anonymousAuthCookieSchema.safeParse(parsed);
    return payload.success ? payload.data : null;
  } catch {
    return null;
  }
}

function isAnonymousAuthCookieUsable(payload: AnonymousAuthCookiePayload): boolean {
  return Date.now() + tokenRefreshSkewMs < payload.expiresAtMs;
}

function readAnonymousAuthCookie(request: Request): AnonymousAuthCookiePayload | null {
  const rawCookie = readCookie(request, anonymousAuthCookieName);
  if (!rawCookie) {
    return null;
  }

  const decoded = decodeAnonymousAuthCookie(rawCookie);
  if (!decoded || !isAnonymousAuthCookieUsable(decoded)) {
    return null;
  }

  return decoded;
}

function shouldUseSecureCookies(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) {
    return forwardedProto === "https";
  }
  return new URL(request.url).protocol === "https:";
}

function appendAnonymousAuthCookie(request: Request, headers: Headers, payload: AnonymousAuthCookiePayload) {
  const ttlSeconds = Math.max(0, Math.floor((payload.expiresAtMs - Date.now()) / 1000));
  appendSetCookie(headers, anonymousAuthCookieName, encodeAnonymousAuthCookie(payload), {
    path: "/",
    maxAge: ttlSeconds,
    httpOnly: true,
    secure: shouldUseSecureCookies(request),
    sameSite: "lax",
  });
}

function appendAnonymousAuthCookieDeletion(request: Request, headers: Headers) {
  appendDeleteCookie(headers, anonymousAuthCookieName, {
    path: "/",
    httpOnly: true,
    secure: shouldUseSecureCookies(request),
    sameSite: "lax",
  });
}

function noStoreJson(payload: unknown, status: number): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

let signingKeyPromise: Promise<CryptoKey> | null = null;

async function loadSigningKey(privateKeyPem: string): Promise<CryptoKey> {
  if (!signingKeyPromise) {
    signingKeyPromise = importPKCS8(privateKeyPem, "ES256");
  }
  return await signingKeyPromise;
}

function createAccountId(): string {
  return `anon_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function POST(request: Request): Promise<Response> {
  let parsedBody: z.infer<typeof issueAnonymousTokenRequestSchema>;
  try {
    parsedBody = parseIssueRequestBody(await request.json().catch(() => ({})));
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : "Invalid anonymous token request payload" },
      400,
    );
  }

  if (!parsedBody.forceRefresh) {
    const existing = readAnonymousAuthCookie(request);
    if (existing && (!parsedBody.accountId || parsedBody.accountId === existing.accountId)) {
      return noStoreJson(
        {
          tokenType: "Bearer",
          accessToken: existing.accessToken,
          accountId: existing.accountId,
          expiresAtMs: existing.expiresAtMs,
        },
        200,
      );
    }
  }

  const issuer = await resolveIssuerFromBackend() ?? resolveIssuer();
  const privateKeyPem = normalizePem(process.env.ANONYMOUS_AUTH_PRIVATE_KEY_PEM);
  if (!issuer || !privateKeyPem) {
    return noStoreJson({ error: "Anonymous auth is not configured" }, 503);
  }

  const accountId = parsedBody.accountId ?? createAccountId();

  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = nowSeconds + parseTokenTtlSeconds(process.env.ANONYMOUS_AUTH_TOKEN_TTL_SECONDS);
    const signingKey = await loadSigningKey(privateKeyPem);

    const accessToken = await new SignJWT({ provider: "anonymous" })
      .setProtectedHeader({ alg: "ES256", kid: anonymousAuthKeyId, typ: "JWT" })
      .setIssuer(issuer)
      .setSubject(accountId)
      .setAudience(anonymousAuthAudience)
      .setIssuedAt(nowSeconds)
      .setNotBefore(nowSeconds - 5)
      .setExpirationTime(expiresAtSeconds)
      .sign(signingKey);

    const payload = {
      tokenType: "Bearer",
      accessToken,
      accountId,
      expiresAtMs: expiresAtSeconds * 1000,
    };
    const response = noStoreJson(payload, 200);
    appendAnonymousAuthCookie(request, response.headers, {
      version: anonymousAuthCookieVersion,
      accessToken,
      accountId,
      expiresAtMs: payload.expiresAtMs,
    });
    return response;
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : "Failed to issue anonymous token" },
      400,
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const response = noStoreJson({ ok: true }, 200);
  appendAnonymousAuthCookieDeletion(request, response.headers);
  return response;
}
