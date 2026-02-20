import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { resolveWorkosRedirectUri } from "./lib/workos-redirect";

function isConfigured(value: string | undefined): boolean {
  const candidate = value?.trim();
  return Boolean(candidate && candidate.length > 0);
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isConfigured(process.env.WORKOS_CLIENT_ID)) {
    return NextResponse.next();
  }

  const redirectUri = resolveWorkosRedirectUri(request);
  if (!redirectUri) {
    return NextResponse.next();
  }

  return authkitMiddleware({ redirectUri })(request, event);
}

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
