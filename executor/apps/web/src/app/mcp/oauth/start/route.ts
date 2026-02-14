import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  buildPendingCookieName,
  createOAuthState,
  encodePendingCookieValue,
  encodePopupResultCookieValue,
  MCP_OAUTH_RESULT_COOKIE,
  McpPopupOAuthProvider,
  type McpOAuthPopupResult,
} from "@/lib/mcp-oauth-provider";

function getExternalOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  if (host && proto) {
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

function popupResultRedirect(request: NextRequest, payload: McpOAuthPopupResult): NextResponse {
  const externalOrigin = getExternalOrigin(request);
  const response = NextResponse.redirect(`${externalOrigin}/mcp/oauth/complete`);
  response.cookies.set({
    name: MCP_OAUTH_RESULT_COOKIE,
    value: encodePopupResultCookieValue(payload),
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 2 * 60,
    path: "/",
  });
  return response;
}

function badPopupResponse(request: NextRequest, message: string): NextResponse {
  return popupResultRedirect(request, { ok: false, error: message });
}

export async function GET(request: NextRequest) {
  const sourceUrlRaw = request.nextUrl.searchParams.get("sourceUrl")?.trim() ?? "";
  if (!sourceUrlRaw) {
    return badPopupResponse(request, "Missing sourceUrl");
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(sourceUrlRaw);
  } catch {
    return badPopupResponse(request, "Invalid sourceUrl");
  }

  const state = createOAuthState();
  const redirectUrl = `${getExternalOrigin(request)}/mcp/oauth/callback`;
  const provider = new McpPopupOAuthProvider({
    redirectUrl,
    state,
  });

  let authResult: "AUTHORIZED" | "REDIRECT";
  try {
    authResult = await auth(provider, { serverUrl: sourceUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start OAuth flow";
    return badPopupResponse(request, message);
  }

  if (authResult === "AUTHORIZED") {
    const tokens = provider.getTokens();
    const accessToken = tokens?.access_token?.trim() ?? "";
    if (!accessToken) {
      return badPopupResponse(request, "OAuth flow completed without an access token");
    }
    return popupResultRedirect(request, {
      ok: true,
      sourceUrl: sourceUrl.toString(),
      accessToken,
      refreshToken: tokens?.refresh_token,
      scope: tokens?.scope,
      expiresIn: typeof tokens?.expires_in === "number" ? tokens.expires_in : undefined,
    });
  }

  const authorizationUrl = provider.getAuthorizationUrl();
  if (!authorizationUrl) {
    return badPopupResponse(request, "Server did not request an OAuth authorization step");
  }

  const pendingCookie = encodePendingCookieValue(provider.toPending(sourceUrl.toString()));
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set({
    name: buildPendingCookieName(state),
    value: pendingCookie,
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}
