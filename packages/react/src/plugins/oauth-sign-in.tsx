import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";

import { cancelOAuth, startOAuth } from "../api/atoms";
import { openOAuthPopup, type OAuthPopupResult } from "../api/oauth-popup";
import { useScope } from "../api/scope-context";
import { Button } from "../components/button";
import {
  OAUTH_POPUP_MESSAGE_TYPE,
  type OAuthStrategy,
  type SecretBackedValue,
} from "@executor-js/sdk";

export type OAuthCompletionPayload = {
  readonly connectionId: string;
  readonly expiresAt: number | null;
  readonly scope: string | null;
};

export type OAuthStartPayload = {
  readonly endpoint: string;
  readonly headers?: Record<string, SecretBackedValue>;
  readonly queryParams?: Record<string, SecretBackedValue>;
  readonly redirectUrl?: string;
  readonly connectionId: string;
  readonly tokenScope?: string;
  readonly strategy: OAuthStrategy;
  readonly pluginId: string;
  readonly identityLabel?: string;
};

export type StartOAuthPopupInput<TPayload extends OAuthCompletionPayload> = {
  readonly payload: OAuthStartPayload;
  readonly onSuccess: (payload: TPayload) => void | Promise<void>;
  readonly onError?: (error: string) => void;
  readonly onAuthorizationStarted?: (result: OAuthAuthorizationStartResult) => void;
};

export type OAuthAuthorizationStartResult = {
  readonly sessionId: string;
  readonly authorizationUrl: string | null;
};

export type StartOAuthAuthorizationInput<TPayload extends OAuthCompletionPayload> = {
  readonly run: () => Promise<OAuthAuthorizationStartResult>;
  readonly onSuccess: (payload: TPayload) => void | Promise<void>;
  readonly onError?: (error: string) => void;
  readonly onAuthorizationStarted?: (result: OAuthAuthorizationStartResult) => void;
};

// Reserved web-route segments at the top level — the cloud app reserves
// these so they can never collide with an org/workspace handle. Anything
// else is treated as `:org` (and optionally `:workspace`) for the purpose
// of rebuilding the OAuth callback path.
const RESERVED_TOP_LEVEL_SEGMENTS = new Set([
  "api",
  "ingest",
  "_astro",
  "home",
  "setup",
  "privacy",
  "terms",
  "mcp",
  "login",
  "logout",
  "callback",
  "_build",
  "_server",
  "static",
  "assets",
]);

const RESERVED_SECOND_LEVEL_SEGMENTS = new Set([
  "-",
  "sources",
  "secrets",
  "policies",
  "connections",
  "tools",
  "settings",
  "billing",
  "_org",
]);

/**
 * Read the URL `:org` (and optional `:workspace`) prefix off the current
 * `window.location.pathname`. Returns `""` server-side or when the page
 * isn't under an org context. Used by `oauthCallbackUrl` to round-trip
 * through the same org/workspace context the source/connection lives in,
 * so the callback handler builds the matching scope stack.
 */
export function currentOrgWorkspacePathPrefix(
  pathname: string = typeof window === "undefined" ? "" : window.location.pathname,
): string {
  const parts = pathname.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const first = parts[0]!;
  if (RESERVED_TOP_LEVEL_SEGMENTS.has(first)) return "";
  if (parts.length === 1) return `/${first}`;
  const second = parts[1]!;
  if (RESERVED_SECOND_LEVEL_SEGMENTS.has(second)) return `/${first}`;
  return `/${first}/${second}`;
}

/**
 * Build the OAuth callback URL the cloud-side handler will receive when
 * the authorization server bounces the user's browser back. Mirrors the
 * org/workspace context off the current page path so the callback resolves
 * the same scope stack as the page that initiated the flow.
 *
 * Default `path` mounts the callback under `/api`. Pass a custom `path`
 * for plugins that own a sub-path (e.g. `/api/oauth/callback` historically;
 * still supported, see overload below).
 */
export function oauthCallbackUrl(
  path = "/api/oauth/callback",
  options?: { readonly contextPathPrefix?: string },
): string {
  if (typeof window === "undefined") return path;
  // Give callers an explicit override (used by tests and server-rendered
  // contexts that already know the prefix). Empty string disables the
  // prefix, matching the legacy single-arg shape.
  const prefix =
    options && "contextPathPrefix" in options
      ? options.contextPathPrefix ?? ""
      : currentOrgWorkspacePathPrefix();

  // Inject the org/workspace prefix between `/api` and the rest of the
  // callback path: /api/oauth/callback → /api/:org/oauth/callback or
  // /api/:org/:workspace/oauth/callback.
  let prefixedPath = path;
  if (prefix && path.startsWith("/api/")) {
    prefixedPath = `/api${prefix}${path.slice("/api".length)}`;
  } else if (prefix && path === "/api") {
    prefixedPath = `/api${prefix}`;
  }
  return `${window.location.origin}${prefixedPath}`;
}

export function oauthConnectionId(input: {
  readonly pluginId: string;
  readonly namespace: string;
  readonly fallback?: string;
}): string {
  const namespace = input.namespace || input.fallback || "default";
  return `${input.pluginId}-oauth2-${namespace}`;
}

export function useOAuthPopupFlow<
  TPayload extends OAuthCompletionPayload = OAuthCompletionPayload,
>(options: {
  readonly popupName: string;
  readonly callbackPath?: string;
  readonly noAuthorizationUrlMessage?: string;
  readonly popupBlockedMessage?: string;
  readonly popupClosedMessage?: string;
  readonly startErrorMessage?: string;
}) {
  const {
    callbackPath,
    noAuthorizationUrlMessage,
    popupBlockedMessage,
    popupClosedMessage,
    popupName,
    startErrorMessage,
  } = options;
  const scopeId = useScope();
  const doStartOAuth = useAtomSet(startOAuth, { mode: "promise" });
  const doCancelOAuth = useAtomSet(cancelOAuth, { mode: "promise" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<string | null>(null);

  const cancelSession = useCallback(
    (sessionId: string) => {
      void doCancelOAuth({
        params: { scopeId },
        payload: { sessionId },
      }).catch(() => undefined);
    },
    [doCancelOAuth, scopeId],
  );

  const cancel = useCallback(() => {
    const sessionId = sessionRef.current;
    cleanupRef.current?.();
    cleanupRef.current = null;
    sessionRef.current = null;
    if (sessionId) cancelSession(sessionId);
    setBusy(false);
  }, [cancelSession]);

  useEffect(
    () => () => {
      const sessionId = sessionRef.current;
      cleanupRef.current?.();
      cleanupRef.current = null;
      sessionRef.current = null;
      if (sessionId) cancelSession(sessionId);
    },
    [cancelSession],
  );

  const openAuthorization = useCallback(
    async (input: StartOAuthAuthorizationInput<TPayload>) => {
      cancel();
      setBusy(true);
      setError(null);
      try {
        const response = await input.run();
        if (response.authorizationUrl === null) {
          const message =
            noAuthorizationUrlMessage ?? "OAuth start did not produce an authorization URL";
          setBusy(false);
          setError(message);
          input.onError?.(message);
          return;
        }

        sessionRef.current = response.sessionId;
        input.onAuthorizationStarted?.(response);
        cleanupRef.current = openOAuthPopup<TPayload>({
          url: response.authorizationUrl,
          popupName,
          channelName: OAUTH_POPUP_MESSAGE_TYPE,
          expectedSessionId: response.sessionId,
          onResult: async (result: OAuthPopupResult<TPayload>) => {
            cleanupRef.current = null;
            sessionRef.current = null;

            if (!result.ok) {
              setBusy(false);
              setError(result.error);
              input.onError?.(result.error);
              return;
            }

            try {
              await input.onSuccess(result);
              setBusy(false);
            } catch (e) {
              const message = e instanceof Error ? e.message : "Failed to persist new connection";
              setBusy(false);
              setError(message);
              input.onError?.(message);
            }
          },
          onClosed: () => {
            cleanupRef.current = null;
            sessionRef.current = null;
            cancelSession(response.sessionId);
            const message =
              popupClosedMessage ??
              "Sign-in cancelled - popup was closed before completing the flow.";
            setBusy(false);
            setError(message);
            input.onError?.(message);
          },
          onOpenFailed: () => {
            cleanupRef.current = null;
            sessionRef.current = null;
            cancelSession(response.sessionId);
            const message = popupBlockedMessage ?? "Sign-in popup was blocked by the browser";
            setBusy(false);
            setError(message);
            input.onError?.(message);
          },
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : (startErrorMessage ?? "Failed to start sign-in");
        setBusy(false);
        setError(message);
        input.onError?.(message);
      }
    },
    [
      cancel,
      cancelSession,
      noAuthorizationUrlMessage,
      popupBlockedMessage,
      popupClosedMessage,
      popupName,
      startErrorMessage,
    ],
  );

  const start = useCallback(
    async (input: StartOAuthPopupInput<TPayload>) => {
      await openAuthorization({
        onSuccess: input.onSuccess,
        onError: input.onError,
        onAuthorizationStarted: input.onAuthorizationStarted,
        run: () =>
          doStartOAuth({
            params: { scopeId },
            payload: {
              ...input.payload,
              redirectUrl: input.payload.redirectUrl ?? oauthCallbackUrl(callbackPath),
            },
          }),
      });
    },
    [callbackPath, doStartOAuth, openAuthorization, scopeId],
  );

  return {
    busy,
    error,
    setError,
    start,
    openAuthorization,
    cancel,
  };
}

export function OAuthSignInButton(props: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly isConnected: boolean;
  readonly onSignIn: () => void;
  readonly reconnectingLabel?: string;
  readonly signingInLabel?: string;
  readonly reconnectLabel?: string;
  readonly signInLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {props.error && <span className="text-xs text-destructive">{props.error}</span>}
      <Button variant="outline" size="sm" onClick={props.onSignIn} disabled={props.busy}>
        {props.busy
          ? props.isConnected
            ? (props.reconnectingLabel ?? "Reconnecting...")
            : (props.signingInLabel ?? "Signing in...")
          : props.isConnected
            ? (props.reconnectLabel ?? "Reconnect")
            : (props.signInLabel ?? "Sign in")}
      </Button>
    </div>
  );
}
