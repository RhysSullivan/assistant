import { SourceStoreError } from "@executor-v2/persistence-ports";

type ControlPlaneErrorCode =
  | "bad_request"
  | "not_found"
  | "method_not_allowed"
  | "internal";

type ControlPlaneErrorResponse = {
  ok: false;
  error: {
    code: ControlPlaneErrorCode;
    message: string;
    details: string | null;
  };
};

const renderCause = (cause: unknown): string => String(cause);

export const toSourceStoreError = (
  operation: string,
  cause: unknown,
): SourceStoreError =>
  new SourceStoreError({
    operation,
    filePath: "convex://control-plane",
    message: "Convex control plane call failed",
    reason: null,
    details: renderCause(cause),
  });

const toErrorCode = (status: number): ControlPlaneErrorCode => {
  switch (status) {
    case 400:
      return "bad_request";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    default:
      return "internal";
  }
};

export const controlPlaneErrorResponse = (
  status: number,
  message: string,
  details: string | null,
): Response =>
  Response.json(
    {
      ok: false,
      error: {
        code: toErrorCode(status),
        message,
        details,
      },
    } satisfies ControlPlaneErrorResponse,
    { status },
  );

const isJsonResponse = (response: Response): boolean =>
  response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;

export const normalizeControlPlaneErrorResponse = (response: Response): Response => {
  if (response.ok || isJsonResponse(response)) {
    return response;
  }

  return controlPlaneErrorResponse(
    response.status,
    "Control plane request failed",
    response.statusText || null,
  );
};
