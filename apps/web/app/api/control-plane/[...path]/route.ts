import { withAuth } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

import {
  applyPrincipalHeaders,
  createLocalPrincipal,
  createWorkosPrincipal,
  getControlPlaneRuntime,
  provisionPrincipal,
} from "../../../../lib/control-plane/server";
import { isWorkosEnabled } from "../../../../lib/workos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    path?: Array<string>;
  }>;
};

const isCsrfSafeMethod = (method: string): boolean =>
  method === "GET" || method === "HEAD" || method === "OPTIONS";

const rewriteControlPlaneRequest = (
  request: NextRequest,
  path: ReadonlyArray<string>,
): Request => {
  const rewrittenUrl = new URL(request.url);
  rewrittenUrl.pathname = `/${path.join("/")}`;
  return new Request(rewrittenUrl, request);
};

const storageErrorResponse = (operation: string, cause: unknown): Response => {
  const details = cause instanceof Error ? cause.message : String(cause);

  return Response.json(
    {
      _tag: "ControlPlaneStorageError",
      operation,
      message: "Control plane operation failed",
      details,
    },
    { status: 500 },
  );
};

const handle = async (request: NextRequest, context: RouteContext): Promise<Response> => {
  try {
    const method = request.method.toUpperCase();
    const { path = [] } = await context.params;

    if (path.length === 0 || path[0] !== "v1") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (!isCsrfSafeMethod(method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== request.nextUrl.origin) {
        return Response.json({ error: "Invalid origin" }, { status: 403 });
      }
    }

    const runtime = await getControlPlaneRuntime();
    const controlPlaneRequest = rewriteControlPlaneRequest(request, path);

    let principal: ReturnType<typeof createLocalPrincipal>;

    if (!isWorkosEnabled()) {
      principal = createLocalPrincipal();
    } else {
      let user:
        | {
            id: string;
            email?: string | null;
            firstName?: string | null;
            lastName?: string | null;
          }
        | null
        | undefined;

      try {
        ({ user } = await withAuth());
      } catch {
        return Response.json({ error: "Authentication unavailable" }, { status: 503 });
      }

      if (!user) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const displayName = [user.firstName, user.lastName]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ")
        || null;

      principal = createWorkosPrincipal({
        subject: user.id,
        email: user.email ?? null,
        displayName,
      });
    }

    await provisionPrincipal(runtime, principal);

    return runtime.handleControlPlane(applyPrincipalHeaders(controlPlaneRequest, principal));
  } catch (cause) {
    console.error("[control-plane] request failed", {
      method: request.method,
      path: request.nextUrl.pathname,
      cause,
    });
    return storageErrorResponse("control-plane.request", cause);
  }
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
