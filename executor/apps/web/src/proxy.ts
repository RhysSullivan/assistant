import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent, NextRequest } from "next/server";

const handler = authkitMiddleware({
  middlewareAuth: {
    enabled: false,
    unauthenticatedPaths: ["/", "/sign-in", "/sign-up", "/callback", "/sign-out"],
  },
});

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return handler(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
