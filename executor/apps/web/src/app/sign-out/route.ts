import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { signOut } from "@workos-inc/authkit-nextjs";
import { externalOriginFromRequest } from "@/lib/http/request-origin";

export async function GET(request: NextRequest) {
  if (!process.env.WORKOS_CLIENT_ID) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return signOut({ returnTo: `${externalOriginFromRequest(request)}/` });
}
