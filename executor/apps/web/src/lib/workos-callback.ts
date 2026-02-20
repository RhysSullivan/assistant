import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";

import { redirectResponse } from "@/lib/http/response";
import { isWorkosDebugEnabled, logWorkosAuth, redactAuthCode } from "@/lib/workos-debug";

const callbackHandler = handleCallbackRoute({
  returnPathname: "/",
  onSuccess: ({ user }) => {
    logWorkosAuth("callback.auth-success", {
      userId: user?.id,
      email: user?.email,
    });
  },
});

const WORKOS_CALLBACK_REPLAY_MS = 10 * 60 * 1000;
const CALLBACK_REPLAY_PRUNE_INTERVAL_MS = 30 * 1000;
const callbackCodeReplay = new Map<string, number>();
let nextReplayPruneAt = 0;

type WorkOSCallbackInput = Parameters<typeof callbackHandler>[0];

function pruneCallbackReplays(now = Date.now()): void {
  if (now < nextReplayPruneAt) {
    return;
  }

  callbackCodeReplay.forEach((expiresAt, code) => {
    if (expiresAt <= now) {
      callbackCodeReplay.delete(code);
    }
  });

  nextReplayPruneAt = now + CALLBACK_REPLAY_PRUNE_INTERVAL_MS;
}

function isReplayedCode(code: string, now = Date.now()): boolean {
  pruneCallbackReplays(now);
  const expiresAt = callbackCodeReplay.get(code);

  if (!expiresAt || expiresAt <= now) {
    if (expiresAt) {
      callbackCodeReplay.delete(code);
    }

    return false;
  }

  return true;
}

function markCodeAsReplayed(code: string, now = Date.now()): void {
  callbackCodeReplay.set(code, now + WORKOS_CALLBACK_REPLAY_MS);
}

export async function handleWorkOSCallback(context: WorkOSCallbackInput): Promise<Response> {
  const request = (context as { request: Request }).request;
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code")?.trim() ?? "";
  const requestId = request.headers.get("x-request-id");

  if (isWorkosDebugEnabled()) {
    logWorkosAuth("callback.request", {
      requestId,
      code: redactAuthCode(code),
      path: requestUrl.pathname,
      host: requestUrl.host,
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      state: requestUrl.searchParams.get("state") ? "present" : "missing",
      authorizationSessionId: requestUrl.searchParams.get("authorization_session_id")
        ? "present"
        : "missing",
      error: requestUrl.searchParams.get("error")
        ? requestUrl.searchParams.get("error")
        : undefined,
      errorDescription: requestUrl.searchParams.get("error_description")
        ? "present"
        : "missing",
    });
  }

  if (code && isReplayedCode(code)) {
    if (isWorkosDebugEnabled()) {
      logWorkosAuth("callback.replay-blocked", {
        requestId,
        code: redactAuthCode(code),
      });
    }

    return redirectResponse("/", 302);
  }

  const response = await callbackHandler(context);

  const responseHeaders = new Headers(response.headers);
  const responseHeaderNames = Array.from(responseHeaders.keys());
  const setCookieHeaders = responseHeaderNames
    .filter((headerName) => headerName.toLowerCase() === "set-cookie")
    .map((headerName) => responseHeaders.get(headerName))
    .filter((value): value is string => value !== null);

  if (isWorkosDebugEnabled()) {
    logWorkosAuth("callback.result", {
      requestId,
      code: redactAuthCode(code),
      status: response.status,
      statusText: response.statusText,
      location: responseHeaders.get("location"),
      headerNames: responseHeaderNames,
      setCookieCount: setCookieHeaders.length,
      setCookieLength: setCookieHeaders[0]?.length ?? 0,
    });
  }

  if (isWorkosDebugEnabled() && setCookieHeaders.length > 0) {
    logWorkosAuth("callback.set-cookie", {
      requestId,
      cookie: setCookieHeaders[0],
    });
  }

  if (isWorkosDebugEnabled() && code && response.status >= 300 && response.status < 400 && setCookieHeaders.length === 0) {
    logWorkosAuth("callback.missing-set-cookie", {
      requestId,
      code: redactAuthCode(code),
      status: response.status,
      statusText: response.statusText,
      location: responseHeaders.get("location"),
      hasLocation: responseHeaders.has("location"),
    });
  }

  if (code && response.status >= 300 && response.status < 400) {
    markCodeAsReplayed(code);

    if (isWorkosDebugEnabled()) {
      logWorkosAuth("callback.code-marked-used", {
        requestId,
        code: redactAuthCode(code),
        status: response.status,
      });
    }

    return response;
  }

  if (isWorkosDebugEnabled()) {
    logWorkosAuth("callback.complete", {
      requestId,
      code: redactAuthCode(code),
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response;
}
