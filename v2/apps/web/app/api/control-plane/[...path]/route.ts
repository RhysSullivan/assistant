import { ControlPlaneAuthHeaders } from "@executor-v2/management-api";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { type NextRequest } from "next/server";

import { isLocalControlPlaneUpstream, isWorkosEnabled } from "../../../../lib/workos";

const controlPlaneUpstream =
  process.env.CONTROL_PLANE_UPSTREAM_URL ?? "http://127.0.0.1:8788";

type TaggedControlPlaneError = {
  _tag:
    | "ControlPlaneBadRequestError"
    | "ControlPlaneUnauthorizedError"
    | "ControlPlaneForbiddenError"
    | "ControlPlaneStorageError";
  operation: string;
  message: string;
  details: string;
};

const readOptionalHeader = (headers: Headers, name: string): string | null => {
  const value = headers.get(name);
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readOptionalString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const tagForStatus = (status: number): TaggedControlPlaneError["_tag"] => {
  switch (status) {
    case 400:
      return "ControlPlaneBadRequestError";
    case 401:
      return "ControlPlaneUnauthorizedError";
    case 403:
      return "ControlPlaneForbiddenError";
    default:
      return "ControlPlaneStorageError";
  }
};

const responseStatusForTag = (status: number): number => {
  switch (status) {
    case 400:
    case 401:
    case 403:
      return status;
    default:
      return 500;
  }
};

const toTaggedErrorPayload = (input: {
  status: number;
  operation: string;
  message: string;
  details: string;
}): TaggedControlPlaneError => ({
  _tag: tagForStatus(input.status),
  operation: input.operation,
  message: input.message,
  details: input.details,
});

const unauthorizedResponse = (): Response =>
  Response.json(
    toTaggedErrorPayload({
      status: 401,
      operation: "control-plane.proxy",
      message: "Authentication required",
      details: "Sign in with WorkOS before calling control-plane APIs",
    }),
    { status: 401 },
  );

const internalErrorResponse = (operation: string, cause: unknown): Response =>
  Response.json(
    toTaggedErrorPayload({
      status: 500,
      operation,
      message: "Control plane proxy failed",
      details: cause instanceof Error ? cause.message : String(cause),
    }),
    { status: 500 },
  );

const toProxyUrl = (request: NextRequest, path: ReadonlyArray<string>): URL => {
  const joinedPath = path.join("/");
  const suffix = joinedPath.length > 0 ? `/${joinedPath}` : "";
  return new URL(`${controlPlaneUpstream}${suffix}${request.nextUrl.search}`);
};

const buildProxyHeaders = (request: NextRequest): Headers => {
  const headers = new Headers();

  const contentType = readOptionalHeader(request.headers, "content-type");
  if (contentType !== null) {
    headers.set("content-type", contentType);
  }

  const accept = readOptionalHeader(request.headers, "accept");
  if (accept !== null) {
    headers.set("accept", accept);
  }

  const acceptEncoding = readOptionalHeader(request.headers, "accept-encoding");
  if (acceptEncoding !== null) {
    headers.set("accept-encoding", acceptEncoding);
  }

  return headers;
};

const toDisplayName = (user: {
  firstName?: string | null;
  lastName?: string | null;
}): string | null => {
  const first = user.firstName?.trim() ?? "";
  const last = user.lastName?.trim() ?? "";
  const fullName = `${first} ${last}`.trim();
  return fullName.length > 0 ? fullName : null;
};

const resolvePrincipalAccountId = (
  request: NextRequest,
  userId: string | null,
): string | null => {
  if (userId !== null) {
    return userId;
  }

  return readOptionalHeader(request.headers, ControlPlaneAuthHeaders.accountId);
};

const normalizeControlPlaneErrorResponse = async (
  upstreamResponse: Response,
): Promise<Response> => {
  const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
  const isJson = contentType.includes("application/json");

  const payload = isJson
    ? await upstreamResponse
        .json()
        .catch(() => null)
    : null;

  if (isRecord(payload)) {
    const tagged = readOptionalString(payload, "_tag");
    const operation = readOptionalString(payload, "operation");
    const message = readOptionalString(payload, "message");
    const details = readOptionalString(payload, "details");

    if (
      tagged !== null
      && operation !== null
      && message !== null
      && details !== null
      && (
        tagged === "ControlPlaneBadRequestError"
        || tagged === "ControlPlaneUnauthorizedError"
        || tagged === "ControlPlaneForbiddenError"
        || tagged === "ControlPlaneStorageError"
      )
    ) {
      return Response.json(
        {
          _tag: tagged,
          operation,
          message,
          details,
        } satisfies TaggedControlPlaneError,
        { status: upstreamResponse.status },
      );
    }

    if (isRecord(payload.error)) {
      const operationFromCode = readOptionalString(payload.error, "code");
      const messageFromError = readOptionalString(payload.error, "message");
      const detailsFromError = readOptionalString(payload.error, "details");

      return Response.json(
        toTaggedErrorPayload({
          status: upstreamResponse.status,
          operation: operationFromCode ?? "control-plane.proxy",
          message: messageFromError ?? "Control plane request failed",
          details: detailsFromError ?? (upstreamResponse.statusText || "Request failed"),
        }),
        { status: responseStatusForTag(upstreamResponse.status) },
      );
    }
  }

  const textBody = await upstreamResponse
    .text()
    .catch(() => "");

  return Response.json(
    toTaggedErrorPayload({
      status: upstreamResponse.status,
      operation: "control-plane.proxy",
      message: "Control plane request failed",
      details:
        textBody.trim().length > 0
          ? textBody.trim()
          : upstreamResponse.statusText || "Request failed",
    }),
    { status: responseStatusForTag(upstreamResponse.status) },
  );
};

const normalizeSuccessResponse = (
  upstreamResponse: Response,
): Response => {
  const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";

  const headers = new Headers();
  if (contentType.length > 0) {
    headers.set("content-type", contentType);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
};

const proxyControlPlaneRequest = async (
  request: NextRequest,
  path: ReadonlyArray<string>,
): Promise<Response> => {
  try {
    const workosEnabled = isWorkosEnabled();
    const user = workosEnabled ? (await withAuth()).user : null;

    let principalAccountId = resolvePrincipalAccountId(request, user?.id ?? null);

    if (workosEnabled && user === null) {
      return unauthorizedResponse();
    }

    if (principalAccountId === null && !workosEnabled && isLocalControlPlaneUpstream()) {
      const localAccountId = process.env.CONTROL_PLANE_LOCAL_ACCOUNT_ID?.trim();
      principalAccountId = localAccountId && localAccountId.length > 0
        ? localAccountId
        : "local-dev";
    }

    if (principalAccountId === null) {
      return unauthorizedResponse();
    }

    const headers = buildProxyHeaders(request);

    headers.set(ControlPlaneAuthHeaders.accountId, principalAccountId);
    headers.set(ControlPlaneAuthHeaders.principalProvider, user ? "workos" : "local");
    headers.set(
      ControlPlaneAuthHeaders.principalSubject,
      user ? `workos:${user.id}` : `local:${principalAccountId}`,
    );

    const email = user?.email?.trim();
    if (email) {
      headers.set(ControlPlaneAuthHeaders.principalEmail, email);
    }

    const displayName = user ? toDisplayName(user) : null;
    if (displayName) {
      headers.set(ControlPlaneAuthHeaders.principalDisplayName, displayName);
    }

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();

    const upstreamResponse = await fetch(toProxyUrl(request, path), {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });

    if (!upstreamResponse.ok) {
      return normalizeControlPlaneErrorResponse(upstreamResponse);
    }

    return normalizeSuccessResponse(upstreamResponse);
  } catch (cause) {
    return internalErrorResponse("control-plane.proxy", cause);
  }
};

type RouteParams = {
  params: Promise<{ path: Array<string> }>;
};

export const GET = async (request: NextRequest, context: RouteParams) =>
  proxyControlPlaneRequest(request, (await context.params).path);

export const POST = async (request: NextRequest, context: RouteParams) =>
  proxyControlPlaneRequest(request, (await context.params).path);

export const DELETE = async (request: NextRequest, context: RouteParams) =>
  proxyControlPlaneRequest(request, (await context.params).path);
