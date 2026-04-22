import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomSet, useAtomValue, Result } from "@effect-atom/atom-react";

import { useScope } from "@executor/react/api/scope-context";
import {
  connectionWriteKeys,
  sourceWriteKeys,
} from "@executor/react/api/reactivity-keys";
import { connectionsAtom, startOAuth } from "@executor/react/api/atoms";
import {
  openOAuthPopup,
  type OAuthPopupResult,
} from "@executor/react/api/oauth-popup";
import { OAUTH_POPUP_MESSAGE_TYPE } from "@executor/sdk";
import { Button } from "@executor/react/components/button";

import { openApiSourceAtom, updateOpenApiSource } from "./atoms";
import {
  OPENAPI_OAUTH_CALLBACK_PATH,
  OPENAPI_OAUTH_POPUP_NAME,
} from "./AddOpenApiSource";
import { OAuth2Auth } from "../sdk/types";

// A successful sign-in mutates BOTH the source row (oauth2 pointer) and
// the Connections primitive (new/refreshed row + possibly new owned
// secrets). Passing only `sourceWriteKeys` leaves `connectionsAtom`
// stale, so `isConnected` keeps returning false and the button sticks
// on "Sign in" until a reload.
const signInWriteKeys = [
  ...sourceWriteKeys,
  ...connectionWriteKeys,
] as const;

// ---------------------------------------------------------------------------
// OpenApiSignInButton — top-bar action on the source detail page
//
// Reads the source's stored OAuth2Auth, runs the same shared OAuth flow
// as Add (authorizationCode via popup, clientCredentials inline through
// `/oauth/start`), and on success refreshes the source OAuth2Auth while
// preserving its logical connection id. Works whether or not the previous
// connection still exists — source-owned OAuth config is the source of truth.
// ---------------------------------------------------------------------------

type CompletionPayload = {
  connectionId: string;
  expiresAt: number | null;
  scope: string | null;
};

export default function OpenApiSignInButton(props: { sourceId: string }) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(openApiSourceAtom(scopeId, props.sourceId));
  const connectionsResult = useAtomValue(connectionsAtom(scopeId));
  const doStartOAuth = useAtomSet(startOAuth, { mode: "promise" });
  const doUpdate = useAtomSet(updateOpenApiSource, { mode: "promise" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const source =
    Result.isSuccess(sourceResult) && sourceResult.value
      ? sourceResult.value
      : null;
  const oauth2 = source?.config.oauth2 ?? null;
  const connections = Result.isSuccess(connectionsResult)
    ? connectionsResult.value
    : null;
  const isConnected =
    oauth2 !== null &&
    connections !== null &&
    connections.some((c) => c.id === oauth2.connectionId);

  const redirectUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${OPENAPI_OAUTH_CALLBACK_PATH}`
      : OPENAPI_OAUTH_CALLBACK_PATH;

  const handleSignIn = useCallback(async () => {
    if (!oauth2) return;
    cleanupRef.current?.();
    cleanupRef.current = null;
    setBusy(true);
    setError(null);
    try {
      const connectionId = oauth2.connectionId;
      const scopes = [...oauth2.scopes];

      if (oauth2.flow === "clientCredentials") {
        if (!oauth2.clientSecretSecretId) {
          setBusy(false);
          setError("client_credentials requires a client secret");
          return;
        }
        const response = await doStartOAuth({
          path: { scopeId },
          payload: {
            endpoint: oauth2.tokenUrl,
            redirectUrl: oauth2.tokenUrl,
            connectionId,
            strategy: {
              kind: "client-credentials",
              tokenEndpoint: oauth2.tokenUrl,
              clientIdSecretId: oauth2.clientIdSecretId,
              clientSecretSecretId: oauth2.clientSecretSecretId,
              scopes,
            },
            pluginId: "openapi",
          },
        });
        if (response.completedConnection === null) {
          setBusy(false);
          setError("client_credentials flow did not mint a connection");
          return;
        }
        const nextAuth = new OAuth2Auth({
          kind: "oauth2",
          connectionId: response.completedConnection.connectionId,
          securitySchemeName: oauth2.securitySchemeName,
          flow: "clientCredentials",
          tokenUrl: oauth2.tokenUrl,
          authorizationUrl: null,
          clientIdSecretId: oauth2.clientIdSecretId,
          clientSecretSecretId: oauth2.clientSecretSecretId,
          scopes,
        });
        await doUpdate({
          path: { scopeId, namespace: props.sourceId },
          payload: { oauth2: nextAuth },
          reactivityKeys: signInWriteKeys,
        });
        setBusy(false);
        return;
      }

      if (!oauth2.authorizationUrl) {
        setBusy(false);
        setError("authorizationCode flow is missing its authorization URL");
        return;
      }

      const response = await doStartOAuth({
        path: { scopeId },
        payload: {
          endpoint: oauth2.tokenUrl,
          redirectUrl,
          connectionId,
          strategy: {
            kind: "authorization-code",
            authorizationEndpoint: oauth2.authorizationUrl,
            tokenEndpoint: oauth2.tokenUrl,
            clientIdSecretId: oauth2.clientIdSecretId,
            clientSecretSecretId: oauth2.clientSecretSecretId,
            scopes,
          },
          pluginId: "openapi",
        },
      });

      if (response.authorizationUrl === null) {
        setBusy(false);
        setError("OAuth start did not produce an authorization URL");
        return;
      }

      cleanupRef.current = openOAuthPopup<CompletionPayload>({
        url: response.authorizationUrl,
        popupName: OPENAPI_OAUTH_POPUP_NAME,
        channelName: OAUTH_POPUP_MESSAGE_TYPE,
        onResult: async (result: OAuthPopupResult<CompletionPayload>) => {
          cleanupRef.current = null;
          if (!result.ok) {
            setBusy(false);
            setError(result.error);
            return;
          }
          try {
            const nextAuth = new OAuth2Auth({
              kind: "oauth2",
              connectionId: result.connectionId,
              securitySchemeName: oauth2.securitySchemeName,
              flow: "authorizationCode",
              tokenUrl: oauth2.tokenUrl,
              authorizationUrl: oauth2.authorizationUrl,
              clientIdSecretId: oauth2.clientIdSecretId,
              clientSecretSecretId: oauth2.clientSecretSecretId,
              scopes,
            });
            await doUpdate({
              path: { scopeId, namespace: props.sourceId },
              payload: { oauth2: nextAuth },
              reactivityKeys: signInWriteKeys,
            });
            setBusy(false);
          } catch (e) {
            setBusy(false);
            setError(
              e instanceof Error ? e.message : "Failed to persist new connection",
            );
          }
        },
        onClosed: () => {
          cleanupRef.current = null;
          setBusy(false);
          setError("Sign-in cancelled — popup was closed before completing the flow.");
        },
        onOpenFailed: () => {
          cleanupRef.current = null;
          setBusy(false);
          setError("Sign-in popup was blocked by the browser");
        },
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Failed to start sign-in");
    }
  }, [
    oauth2,
    scopeId,
    props.sourceId,
    redirectUrl,
    doStartOAuth,
    doUpdate,
  ]);

  if (!oauth2) return null;

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleSignIn()}
        disabled={busy}
      >
        {busy
          ? isConnected
            ? "Reconnecting…"
            : "Signing in…"
          : isConnected
            ? "Reconnect"
            : "Sign in"}
      </Button>
    </div>
  );
}
