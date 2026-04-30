import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomSet, useAtomValue, Result } from "@effect-atom/atom-react";

import {
  cancelOAuth,
  connectionsAtom,
  startOAuth,
} from "@executor/react/api/atoms";
import {
  openOAuthPopup,
  type OAuthPopupResult,
} from "@executor/react/api/oauth-popup";
import { useScope } from "@executor/react/api/scope-context";
import { sourceWriteKeys } from "@executor/react/api/reactivity-keys";
import { Button } from "@executor/react/components/button";
import { OAUTH_POPUP_MESSAGE_TYPE } from "@executor/sdk";
import { slugifyNamespace } from "@executor/react/plugins/source-identity";

import { graphqlSourceAtom, updateGraphqlSource } from "./atoms";

type GraphqlOAuthPopupPayload = {
  connectionId: string;
  expiresAt: number | null;
  scope: string | null;
};

const graphqlOAuthConnectionId = (namespaceSlug: string): string =>
  `graphql-oauth2-${namespaceSlug || "default"}`;

export default function GraphqlSignInButton(props: { sourceId: string }) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(graphqlSourceAtom(scopeId, props.sourceId));
  const connectionsResult = useAtomValue(connectionsAtom(scopeId));
  const doStartOAuth = useAtomSet(startOAuth, { mode: "promise" });
  const doCancelOAuth = useAtomSet(cancelOAuth, { mode: "promise" });
  const doUpdate = useAtomSet(updateGraphqlSource, { mode: "promise" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<string | null>(null);

  const cancelActiveOAuth = useCallback(() => {
    const sessionId = sessionRef.current;
    cleanupRef.current?.();
    cleanupRef.current = null;
    sessionRef.current = null;
    if (sessionId) {
      void doCancelOAuth({
        path: { scopeId },
        payload: { sessionId },
      }).catch(() => undefined);
    }
  }, [doCancelOAuth, scopeId]);

  useEffect(() => () => cancelActiveOAuth(), [cancelActiveOAuth]);

  const source =
    Result.isSuccess(sourceResult) && sourceResult.value
      ? sourceResult.value
      : null;
  const oauth2 = source?.auth.kind === "oauth2" ? source.auth : null;
  const connections = Result.isSuccess(connectionsResult)
    ? connectionsResult.value
    : null;
  const isConnected =
    oauth2 !== null &&
    connections !== null &&
    connections.some((c) => c.id === oauth2.connectionId);

  const handleSignIn = useCallback(async () => {
    if (!source || !oauth2) return;
    cancelActiveOAuth();
    setBusy(true);
    setError(null);
    try {
      const namespaceSlug = slugifyNamespace(source.namespace) || "graphql";
      const connectionId = graphqlOAuthConnectionId(namespaceSlug);
      const response = await doStartOAuth({
        path: { scopeId },
        payload: {
          endpoint: source.endpoint,
          ...(Object.keys(source.headers).length > 0
            ? { headers: source.headers }
            : {}),
          ...(Object.keys(source.queryParams).length > 0
            ? { queryParams: source.queryParams }
            : {}),
          redirectUrl: `${window.location.origin}/api/oauth/callback`,
          connectionId,
          strategy: { kind: "dynamic-dcr" },
          pluginId: "graphql",
          identityLabel: `${source.name.trim() || source.namespace || "GraphQL"} OAuth`,
        },
      });
      if (response.authorizationUrl === null) {
        setBusy(false);
        setError("OAuth start did not produce an authorization URL");
        return;
      }

      sessionRef.current = response.sessionId;
      cleanupRef.current = openOAuthPopup<GraphqlOAuthPopupPayload>({
        url: response.authorizationUrl,
        popupName: "graphql-oauth",
        channelName: OAUTH_POPUP_MESSAGE_TYPE,
        expectedSessionId: response.sessionId,
        onResult: async (
          result: OAuthPopupResult<GraphqlOAuthPopupPayload>,
        ) => {
          cleanupRef.current = null;
          sessionRef.current = null;
          if (!result.ok) {
            setBusy(false);
            setError(result.error);
            return;
          }
          try {
            await doUpdate({
              path: { scopeId, namespace: props.sourceId },
              payload: {
                auth: { kind: "oauth2", connectionId: result.connectionId },
              },
              reactivityKeys: sourceWriteKeys,
            });
            setBusy(false);
          } catch (e) {
            setBusy(false);
            setError(
              e instanceof Error
                ? e.message
                : "Failed to persist new connection",
            );
          }
        },
        onClosed: () => {
          const sessionId = response.sessionId;
          cleanupRef.current = null;
          sessionRef.current = null;
          void doCancelOAuth({
            path: { scopeId },
            payload: { sessionId },
          }).catch(() => undefined);
          setBusy(false);
          setError(
            "Sign-in cancelled — popup was closed before completing the flow.",
          );
        },
        onOpenFailed: () => {
          const sessionId = response.sessionId;
          cleanupRef.current = null;
          sessionRef.current = null;
          void doCancelOAuth({
            path: { scopeId },
            payload: { sessionId },
          }).catch(() => undefined);
          setBusy(false);
          setError("Sign-in popup was blocked by the browser");
        },
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Failed to start sign-in");
    }
  }, [
    source,
    oauth2,
    scopeId,
    props.sourceId,
    doStartOAuth,
    doCancelOAuth,
    doUpdate,
    cancelActiveOAuth,
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
            ? "Reconnecting..."
            : "Signing in..."
          : isConnected
            ? "Reconnect"
            : "Sign in"}
      </Button>
    </div>
  );
}
