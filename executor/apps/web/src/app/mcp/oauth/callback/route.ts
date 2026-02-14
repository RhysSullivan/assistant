import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  buildPendingCookieName,
  decodePendingCookieValue,
  encodePopupResultCookieValue,
  MCP_OAUTH_RESULT_COOKIE,
  McpPopupOAuthProvider,
  type McpOAuthPopupResult,
} from "@/lib/mcp-oauth-provider";

function popupResultRedirect(
  request: NextRequest,
  pendingCookieName: string | null,
  payload: McpOAuthPopupResult,
): NextResponse {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const origin = host && proto ? `${proto}://${host}` : request.nextUrl.origin;
  const response = NextResponse.redirect(`${origin}/mcp/oauth/complete`);
  response.cookies.set({
    name: MCP_OAUTH_RESULT_COOKIE,
    value: encodePopupResultCookieValue(payload),
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 2 * 60,
    path: "/",
  });
  if (pendingCookieName) {
    response.cookies.delete(pendingCookieName);
  }
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const error = request.nextUrl.searchParams.get("error")?.trim();

  if (!state) {
    return popupResultRedirect(request, null, { ok: false, error: "Missing OAuth state" });
  }

  const cookieName = buildPendingCookieName(state);
  const rawPending = request.cookies.get(cookieName)?.value;
  const pending = rawPending ? decodePendingCookieValue(rawPending) : null;

  if (!pending) {
    return popupResultRedirect(request, cookieName, {
      ok: false,
      error: "OAuth session expired. Try connecting again.",
    });
  }

  if (error) {
    return popupResultRedirect(request, cookieName, { ok: false, error: `OAuth error: ${error}` });
  }

  if (!code) {
    return popupResultRedirect(request, cookieName, {
      ok: false,
      error: "Missing OAuth authorization code",
    });
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(pending.sourceUrl);
  } catch {
    return popupResultRedirect(request, cookieName, { ok: false, error: "Invalid MCP source URL" });
  }

  const provider = new McpPopupOAuthProvider({
    redirectUrl: pending.redirectUrl,
    state: pending.state,
    codeVerifier: pending.codeVerifier,
    clientInformation: pending.clientInformation,
  });

  try {
    await auth(provider, {
      serverUrl: sourceUrl,
      authorizationCode: code,
    });
  } catch (finishError) {
    return popupResultRedirect(request, cookieName, {
      ok: false,
      error: finishError instanceof Error ? finishError.message : "Failed to finish OAuth",
    });
  }

  const tokens = provider.getTokens();
  const accessToken = tokens?.access_token?.trim() ?? "";
  if (!accessToken) {
    return popupResultRedirect(request, cookieName, {
      ok: false,
      error: "OAuth completed without an access token",
    });
  }

  return popupResultRedirect(request, cookieName, {
    ok: true,
    sourceUrl: pending.sourceUrl,
    accessToken,
    refreshToken: tokens?.refresh_token,
    scope: tokens?.scope,
    expiresIn: typeof tokens?.expires_in === "number" ? tokens.expires_in : undefined,
  });
}
