import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { readOptionalQueryParam, readOptionalReferrerQueryParam } from "@/lib/http/query-params";
import { isWorkosDebugEnabled, logWorkosAuth } from "@/lib/workos-debug";
import { resolveWorkosRedirectUri } from "@/lib/workos-redirect";

const AUTHKIT_PASSTHROUGH_QUERY_KEYS = [
  "authorization_session_id",
  "redirect_uri",
  "state",
  "client_id",
];

function trim(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}

const convexUrl =
  trim(process.env.EXECUTOR_WEB_CONVEX_URL)
  ?? trim(process.env.CONVEX_URL)
  ?? trim(process.env.NEXT_PUBLIC_CONVEX_URL);

async function resolveWorkosOrganizationId(organizationId: string): Promise<string | undefined> {
  if (!convexUrl) {
    return undefined;
  }

  try {
    const response = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "organizations:resolveWorkosOrganizationId",
        args: { organizationId },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = await response.json() as {
      status?: string;
      value?: unknown;
    };

    return payload.status === "success" && typeof payload.value === "string"
      ? payload.value
      : undefined;
  } catch {
    return undefined;
  }
}

function appendAuthkitPassthroughQueryParams(requestUrl: URL, authorizationUrl: string): string {
  const nextUrl = new URL(authorizationUrl);

  for (const key of AUTHKIT_PASSTHROUGH_QUERY_KEYS) {
    const value = requestUrl.searchParams.get(key);
    if (!value || value.trim().length === 0) {
      continue;
    }

    nextUrl.searchParams.set(key, value.trim());
  }

  return nextUrl.toString();
}

async function resolveOrganizationHint(requestUrl: URL): Promise<string | undefined> {
  const organizationHint = readOptionalQueryParam(requestUrl, [
    "organizationId",
    "organization_id",
    "orgId",
    "org_id",
  ]);

  if (!organizationHint) {
    return undefined;
  }

  if (organizationHint.startsWith("org_")) {
    return organizationHint;
  }

  return await resolveWorkosOrganizationId(organizationHint);
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!process.env.WORKOS_CLIENT_ID) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const requestUrl = request.nextUrl;
  const oauthRedirectUri =
    readOptionalQueryParam(requestUrl, ["redirect_uri", "redirectUri"])
    ?? readOptionalReferrerQueryParam(request, ["redirect_uri", "redirectUri"]);
  const oauthState =
    readOptionalQueryParam(requestUrl, ["state"])
    ?? readOptionalReferrerQueryParam(request, ["state"]);
  const oauthClientId =
    readOptionalQueryParam(requestUrl, ["client_id", "clientId"])
    ?? readOptionalReferrerQueryParam(request, ["client_id", "clientId"]);
  const redirectUri = oauthRedirectUri ?? resolveWorkosRedirectUri(request);
  if (!redirectUri) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isWorkosDebugEnabled()) {
    logWorkosAuth("sign-in.redirect", {
      redirectUri,
      requestHost: requestUrl.host,
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto") ?? requestUrl.protocol,
      hasOrganizationHint: Boolean(readOptionalQueryParam(requestUrl, ["organizationId", "organization_id", "orgId", "org_id"])),
    });
  }
  const organizationId = await resolveOrganizationHint(requestUrl);
  const loginHint = readOptionalQueryParam(requestUrl, ["loginHint", "login_hint", "email"]);

  const baseAuthorizationUrl = await getSignInUrl({
    redirectUri,
    organizationId,
    loginHint,
    state: oauthState,
  });

  const authorizationUrl = appendAuthkitPassthroughQueryParams(requestUrl, baseAuthorizationUrl);
  const finalUrl = new URL(authorizationUrl);

  if (oauthRedirectUri) {
    finalUrl.searchParams.set("redirect_uri", oauthRedirectUri);
  }
  if (oauthState) {
    finalUrl.searchParams.set("state", oauthState);
  }
  if (oauthClientId && oauthClientId.startsWith("client_")) {
    finalUrl.searchParams.set("client_id", oauthClientId);
  }

  return NextResponse.redirect(finalUrl);
}
