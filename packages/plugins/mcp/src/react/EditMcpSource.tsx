import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useAtomSet, useAtomRefresh, Result } from "@effect-atom/atom-react";

import { openOAuthPopup, type OAuthPopupResult } from "@executor/plugin-oauth2/react";

import { mcpSourceAtom, startMcpOAuth, updateMcpSource } from "./atoms";
import { useScope } from "@executor/react/api/scope-context";
import {
  SourceIdentityFields,
  useSourceIdentity,
} from "@executor/react/plugins/source-identity";
import { SourceConfig, type AuthMode, type OAuthStatus } from "@executor/react/plugins/source-config";
import { newKeyValueEntry, type KeyValueEntry } from "@executor/react/plugins/key-value-list";
import { useSecretPickerSecrets } from "@executor/react/plugins/use-secret-picker-secrets";
import { Button } from "@executor/react/components/button";
import { FloatActions } from "@executor/react/components/float-actions";
import type { McpStoredSourceSchemaType } from "../sdk/stored-source";
import type { McpConnectionAuth } from "../sdk/types";
import { MCP_OAUTH_CHANNEL, MCP_OAUTH_POPUP_NAME, type McpOAuthTokens } from "./types";

// ---------------------------------------------------------------------------
// Remote edit form
// ---------------------------------------------------------------------------

type DetectedAuth = {
  mode: AuthMode;
  bearerSecretId: string | null;
  apiKeyName: string;
  apiKeySecretId: string | null;
  apiKeyLocation: "header" | "query";
};

function detectAuth(auth: McpConnectionAuth): DetectedAuth {
  const empty = {
    bearerSecretId: null,
    apiKeyName: "",
    apiKeySecretId: null,
    apiKeyLocation: "header" as const,
  };
  if (auth.kind === "oauth2") return { mode: "oauth", ...empty };
  if (auth.kind === "header") {
    if (auth.headerName === "Authorization" && auth.prefix === "Bearer ") {
      return { mode: "bearer", ...empty, bearerSecretId: auth.secretId };
    }
    return {
      mode: "apikey",
      ...empty,
      apiKeyName: auth.headerName,
      apiKeySecretId: auth.secretId,
      apiKeyLocation: "header",
    };
  }
  if (auth.kind === "query") {
    return {
      mode: "apikey",
      ...empty,
      apiKeyName: auth.paramName,
      apiKeySecretId: auth.secretId,
      apiKeyLocation: "query",
    };
  }
  return { mode: "none", ...empty };
}

function initialMcpOAuthTokens(auth: McpConnectionAuth): McpOAuthTokens | null {
  if (auth.kind !== "oauth2") return null;
  return {
    accessTokenSecretId: auth.accessTokenSecretId,
    refreshTokenSecretId: auth.refreshTokenSecretId,
    tokenType: auth.tokenType,
    expiresAt: auth.expiresAt,
    scope: auth.scope,
  };
}

function RemoteEditForm(props: {
  sourceId: string;
  initial: McpStoredSourceSchemaType & { config: { transport: "remote" } };
  onSave: () => void;
}) {
  const scopeId = useScope();
  const doUpdate = useAtomSet(updateMcpSource, { mode: "promise" });
  const doStartOAuth = useAtomSet(startMcpOAuth, { mode: "promise" });
  const refreshSource = useAtomRefresh(mcpSourceAtom(scopeId, props.sourceId));
  const secretList = useSecretPickerSecrets();

  const identity = useSourceIdentity({
    fallbackName: props.initial.name,
    fallbackNamespace: props.initial.namespace,
  });
  const [endpoint, setEndpoint] = useState(props.initial.config.endpoint);
  const [headers, setHeaders] = useState<readonly KeyValueEntry[]>(() =>
    Object.entries(props.initial.config.headers ?? {}).map(([name, value]) =>
      newKeyValueEntry({ key: name, value, type: "text" }),
    ),
  );

  const initialAuth = detectAuth(props.initial.config.auth);
  const [authMode, setAuthMode] = useState<AuthMode>(initialAuth.mode);
  const [bearerSecretId, setBearerSecretId] = useState<string | null>(
    initialAuth.bearerSecretId,
  );
  const [apiKeyName, setApiKeyName] = useState<string>(initialAuth.apiKeyName);
  const [apiKeySecretId, setApiKeySecretId] = useState<string | null>(
    initialAuth.apiKeySecretId,
  );
  const [apiKeyLocation, setApiKeyLocation] = useState<"header" | "query">(
    initialAuth.apiKeyLocation,
  );

  const [oauthTokens, setOauthTokens] = useState<McpOAuthTokens | null>(
    initialMcpOAuthTokens(props.initial.config.auth),
  );
  const [oauthDirty, setOauthDirty] = useState(false);
  const [startingOAuth, setStartingOAuth] = useState(false);
  const [oauth2Error, setOauth2Error] = useState<string | null>(null);
  const oauthCleanup = useRef<(() => void) | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const identityDirty = identity.name.trim() !== props.initial.name.trim();

  const oauthStatus: OAuthStatus = oauthTokens
    ? { step: "authenticated" }
    : startingOAuth
      ? { step: "waiting" }
      : oauth2Error
        ? { step: "error", message: oauth2Error }
        : { step: "idle" };

  useEffect(() => () => oauthCleanup.current?.(), []);

  const handleHeadersChange = (entries: readonly KeyValueEntry[]) => {
    setHeaders(entries);
    setDirty(true);
  };

  const handleAuthModeChange = (mode: AuthMode) => {
    setAuthMode(mode);
    setDirty(true);
  };

  const handleBearerSecretChange = (secretId: string) => {
    setBearerSecretId(secretId);
    setDirty(true);
  };

  const handleApiKeyNameChange = (name: string) => {
    setApiKeyName(name);
    setDirty(true);
  };

  const handleApiKeySecretChange = (secretId: string) => {
    setApiKeySecretId(secretId);
    setDirty(true);
  };

  const handleApiKeyLocationChange = (location: "header" | "query") => {
    setApiKeyLocation(location);
    setDirty(true);
  };

  const handleSignOut = useCallback(() => {
    oauthCleanup.current?.();
    oauthCleanup.current = null;
    setOauthTokens(null);
    setOauth2Error(null);
    setStartingOAuth(false);
    setOauthDirty(true);
    setDirty(true);
  }, []);

  const handleStartOAuth = useCallback(async () => {
    oauthCleanup.current?.();
    oauthCleanup.current = null;
    setStartingOAuth(true);
    setOauth2Error(null);
    try {
      const redirectUrl = `${window.location.origin}/api/mcp/oauth/callback`;
      const result = await doStartOAuth({
        path: { scopeId },
        payload: { endpoint: endpoint.trim(), redirectUrl },
      });

      oauthCleanup.current = openOAuthPopup<McpOAuthTokens>({
        url: result.authorizationUrl,
        popupName: MCP_OAUTH_POPUP_NAME,
        channelName: MCP_OAUTH_CHANNEL,
        onResult: (data: OAuthPopupResult<McpOAuthTokens>) => {
          oauthCleanup.current = null;
          setStartingOAuth(false);
          if (data.ok) {
            setOauthTokens({
              accessTokenSecretId: data.accessTokenSecretId,
              refreshTokenSecretId: data.refreshTokenSecretId,
              tokenType: data.tokenType,
              expiresAt: data.expiresAt,
              scope: data.scope,
            });
            setOauth2Error(null);
            setOauthDirty(true);
            setDirty(true);
          } else {
            setOauth2Error(data.error);
          }
        },
        onClosed: () => {
          oauthCleanup.current = null;
          setStartingOAuth(false);
          setOauth2Error("OAuth cancelled — popup was closed before completing the flow.");
        },
        onOpenFailed: () => {
          oauthCleanup.current = null;
          setStartingOAuth(false);
          setOauth2Error("OAuth popup was blocked by the browser");
        },
      });
    } catch (e) {
      setStartingOAuth(false);
      setOauth2Error(e instanceof Error ? e.message : "Failed to start OAuth");
    }
  }, [doStartOAuth, endpoint, scopeId]);

  const handleCancelOAuth = useCallback(() => {
    oauthCleanup.current?.();
    oauthCleanup.current = null;
    setStartingOAuth(false);
    setOauth2Error(null);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const headersObj: Record<string, string> = {};
      for (const entry of headers) {
        const name = entry.key.trim();
        if (name) headersObj[name] = entry.value;
      }

      const trimmedApiKeyName = apiKeyName.trim();
      const authPayload =
        authMode === "bearer" && bearerSecretId
          ? {
              kind: "header" as const,
              headerName: "Authorization",
              secretId: bearerSecretId,
              prefix: "Bearer ",
            }
          : authMode === "apikey" && apiKeySecretId && trimmedApiKeyName
            ? apiKeyLocation === "header"
              ? {
                  kind: "header" as const,
                  headerName: trimmedApiKeyName,
                  secretId: apiKeySecretId,
                }
              : {
                  kind: "query" as const,
                  paramName: trimmedApiKeyName,
                  secretId: apiKeySecretId,
                }
            : authMode === "oauth" && oauthDirty
              ? oauthTokens
                ? {
                    kind: "oauth2" as const,
                    accessTokenSecretId: oauthTokens.accessTokenSecretId,
                    refreshTokenSecretId: oauthTokens.refreshTokenSecretId,
                    tokenType: oauthTokens.tokenType,
                    expiresAt: oauthTokens.expiresAt,
                    scope: oauthTokens.scope,
                  }
                : { kind: "none" as const }
              : authMode === "none"
                ? { kind: "none" as const }
                : undefined;

      await doUpdate({
        path: { scopeId, namespace: props.sourceId },
        payload: {
          name: identity.name.trim() || undefined,
          endpoint: endpoint.trim() || undefined,
          headers: headersObj,
          ...(authPayload ? { auth: authPayload } : {}),
        },
      });
      refreshSource();
      setDirty(false);
      setOauthDirty(false);
      props.onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update source");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      <SourceIdentityFields
        identity={identity}
        namespaceReadOnly
        endpoint={endpoint}
        onEndpointChange={(v) => { setEndpoint(v); setDirty(true); }}
        endpointLabel="URL"
        endpointPlaceholder="https://mcp.example.com"
      />

      <SourceConfig
        authMode={authMode}
        onAuthModeChange={handleAuthModeChange}
        allowedAuthModes={["none", "apikey", "bearer", "oauth"]}
        bearerSecretId={bearerSecretId}
        onBearerSecretChange={handleBearerSecretChange}
        apiKeyName={apiKeyName}
        onApiKeyNameChange={handleApiKeyNameChange}
        apiKeySecretId={apiKeySecretId}
        onApiKeySecretChange={handleApiKeySecretChange}
        apiKeyLocation={apiKeyLocation}
        onApiKeyLocationChange={handleApiKeyLocationChange}
        oauthStatus={oauthStatus}
        onOAuthSignIn={handleStartOAuth}
        onOAuthCancel={handleCancelOAuth}
        onOAuthSignOut={oauthTokens ? handleSignOut : undefined}
        headers={headers}
        onHeadersChange={handleHeadersChange}
        secrets={secretList}
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <FloatActions>
        <Button onClick={handleSave} disabled={(!dirty && !identityDirty) || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </FloatActions>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stdio read-only view
// ---------------------------------------------------------------------------

function StdioReadOnly(props: {
  sourceId: string;
  initial: McpStoredSourceSchemaType & { config: { transport: "stdio" } };
  onSave: () => void;
}) {
  const { command, args } = props.initial.config;
  return (
    <div className="flex flex-1 flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Stdio MCP sources cannot be edited in the UI. Modify the executor.jsonc config file
        directly.
      </p>

      <p className="font-mono text-xs text-muted-foreground">
        {command} {(args ?? []).join(" ")}
      </p>

      <FloatActions>
        <Button onClick={props.onSave}>Done</Button>
      </FloatActions>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EditMcpSource({
  sourceId,
  onSave,
}: {
  readonly sourceId: string;
  readonly onSave: () => void;
}) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(mcpSourceAtom(scopeId, sourceId));

  if (!Result.isSuccess(sourceResult) || !sourceResult.value) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">Loading configuration…</p>
      </div>
    );
  }

  const source = sourceResult.value;

  if (source.config.transport === "stdio") {
    return (
      <StdioReadOnly
        sourceId={sourceId}
        initial={source as McpStoredSourceSchemaType & { config: { transport: "stdio" } }}
        onSave={onSave}
      />
    );
  }

  return (
    <RemoteEditForm
      sourceId={sourceId}
      initial={source as McpStoredSourceSchemaType & { config: { transport: "remote" } }}
      onSave={onSave}
    />
  );
}
