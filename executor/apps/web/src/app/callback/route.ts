import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";

function getExternalOrigin(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  if (host && proto) {
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  if (!process.env.WORKOS_CLIENT_ID) {
    return redirect("/");
  }
  const { handleAuth } = await import("@workos-inc/authkit-nextjs");
  return handleAuth({ baseURL: getExternalOrigin(request) })(request);
}
