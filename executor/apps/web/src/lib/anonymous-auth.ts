export type AnonymousAuthToken = {
  accessToken: string;
  accountId: string;
  expiresAtMs: number;
};

const TOKEN_EXPIRY_SKEW_MS = 60_000;
let cachedToken: AnonymousAuthToken | null = null;
let cachedAccountId: string | null = null;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function isTokenUsable(token: AnonymousAuthToken): boolean {
  return Date.now() + TOKEN_EXPIRY_SKEW_MS < token.expiresAtMs;
}

function clearTokenCache() {
  cachedToken = null;
}

export function clearAnonymousAuth(options?: { clearAccount?: boolean }) {
  clearTokenCache();
  if (options?.clearAccount) {
    cachedAccountId = null;
  }

  if (canUseStorage()) {
    void fetch("/api/auth/anonymous-token", {
      method: "DELETE",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  }
}

function persistAnonymousAuth(token: AnonymousAuthToken) {
  cachedToken = token;
  cachedAccountId = token.accountId;
}

export function readStoredAnonymousAuthToken(): AnonymousAuthToken | null {
  if (!cachedToken) {
    return null;
  }

  if (!isTokenUsable(cachedToken)) {
    clearTokenCache();
    return null;
  }

  return cachedToken;
}

async function requestAnonymousAuthToken(options?: {
  accountId?: string;
  forceRefresh?: boolean;
}): Promise<AnonymousAuthToken> {
  const response = await fetch("/api/auth/anonymous-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      accountId: options?.accountId,
      forceRefresh: options?.forceRefresh,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to obtain anonymous auth token");
  }

  const payload = await response.json() as {
    accessToken?: unknown;
    accountId?: unknown;
    expiresAtMs?: unknown;
  };

  if (
    typeof payload.accessToken !== "string"
    || typeof payload.accountId !== "string"
    || typeof payload.expiresAtMs !== "number"
  ) {
    throw new Error("Anonymous token response was malformed");
  }

  return {
    accessToken: payload.accessToken,
    accountId: payload.accountId,
    expiresAtMs: payload.expiresAtMs,
  };
}

export async function getAnonymousAuthToken(
  forceRefresh = false,
  requestedAccountId?: string,
): Promise<AnonymousAuthToken> {
  if (!forceRefresh) {
    const stored = readStoredAnonymousAuthToken();
    if (stored && (!requestedAccountId || stored.accountId === requestedAccountId)) {
      return stored;
    }
  }

  const accountId = requestedAccountId ?? cachedAccountId ?? undefined;
  const fresh = await requestAnonymousAuthToken({ accountId, forceRefresh });
  persistAnonymousAuth(fresh);
  return fresh;
}
