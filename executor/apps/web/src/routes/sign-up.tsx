import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { getAuthkit } from "@workos/authkit-tanstack-react-start";
import { api } from "@executor/database/convex/_generated/api";
import type { Id } from "@executor/database/convex/_generated/dataModel";
import { readOptionalQueryParam } from "@/lib/http/query-params";
import { redirectResponse } from "@/lib/http/response";
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
  ?? trim(process.env.VITE_CONVEX_URL);
const convexClient = convexUrl ? new ConvexHttpClient(convexUrl) : null;

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
  const organizationHint = readOptionalQueryParam(requestUrl, ["organization_id"]);

  if (!organizationHint) {
    return undefined;
  }

  if (organizationHint.startsWith("org_")) {
    return organizationHint;
  }

  if (!convexClient) {
    return undefined;
  }

  try {
    const workosOrganizationId = await convexClient.query(
      api.organizations.resolveWorkosOrganizationId,
      { organizationId: organizationHint as Id<"organizations"> },
    );
    return typeof workosOrganizationId === "string" ? workosOrganizationId : undefined;
  } catch {
    return undefined;
  }
}

async function handleSignUp(request: Request): Promise<Response> {
  if (!process.env.WORKOS_CLIENT_ID) {
    return redirectResponse("/");
  }

  const requestUrl = new URL(request.url);
  const oauthRedirectUri = readOptionalQueryParam(requestUrl, ["redirect_uri"]);
  const oauthState = readOptionalQueryParam(requestUrl, ["state"]);
  const oauthClientId = readOptionalQueryParam(requestUrl, ["client_id"]);
  const redirectUri = oauthRedirectUri ?? resolveWorkosRedirectUri(request);
  if (!redirectUri) {
    return redirectResponse("/");
  }

  if (isWorkosDebugEnabled()) {
    logWorkosAuth("sign-up.redirect", {
      redirectUri,
      requestHost: requestUrl.host,
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto") ?? requestUrl.protocol,
      hasOrganizationHint: Boolean(readOptionalQueryParam(requestUrl, ["organization_id"])),
    });
  }
  const organizationId = await resolveOrganizationHint(requestUrl);
  const loginHint = readOptionalQueryParam(requestUrl, ["login_hint"]);

  const authkit = await getAuthkit();
  const baseAuthorizationUrl = await authkit.getSignUpUrl({
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

  return redirectResponse(finalUrl.toString());
}

export const Route = createFileRoute("/sign-up")({
  server: {
    handlers: {
      GET: ({ request }) => handleSignUp(request),
    },
  },
});
