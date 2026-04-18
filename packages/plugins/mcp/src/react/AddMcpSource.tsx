import { useReducer, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useAtomSet } from "@effect-atom/atom-react";
import { Link } from "@tanstack/react-router";

import { openOAuthPopup, type OAuthPopupResult } from "@executor/plugin-oauth2/react";

import { useScope } from "@executor/react/api/scope-context";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@executor/react/components/breadcrumb";
import { Button } from "@executor/react/components/button";
import {
  CardStack,
  CardStackContent,
  CardStackEntryField,
} from "@executor/react/components/card-stack";
import { FieldError } from "@executor/react/components/field";
import { FilterTabs } from "@executor/react/components/filter-tabs";
import { Tabs, TabsList, TabsTrigger } from "@executor/react/components/tabs";
import { FloatActions } from "@executor/react/components/float-actions";
import { Input } from "@executor/react/components/input";
import { IOSSpinner, Spinner } from "@executor/react/components/spinner";
import { Textarea } from "@executor/react/components/textarea";
import { SourceConfig, type AuthMode, type OAuthStatus } from "@executor/react/plugins/source-config";
import type { KeyValueEntry } from "@executor/react/plugins/key-value-list";
import { SourceOperations, type OperationEntry } from "@executor/react/plugins/source-operations";
import { OperationDetail } from "@executor/react/components/operation-detail";
import { buildToolTypeScriptPreview } from "@executor/sdk";
import {
  displayNameFromUrl,
  slugifyNamespace,
  SourceIdentityFields,
  useSourceIdentity,
} from "@executor/react/plugins/source-identity";
import { useSecretPickerSecrets } from "@executor/react/plugins/use-secret-picker-secrets";
import { probeMcpEndpoint, addMcpSource, startMcpOAuth } from "./atoms";
import { mcpPresets, type McpPreset } from "../sdk/presets";
import type { McpProbeResult } from "../sdk/plugin";
import {
  MCP_OAUTH_CHANNEL,
  MCP_OAUTH_POPUP_NAME,
  type McpOAuthTokens,
} from "./types";

// ---------------------------------------------------------------------------
// Preset lookup
// ---------------------------------------------------------------------------

function findPreset(id: string | undefined): McpPreset | undefined {
  if (!id) return undefined;
  return mcpPresets.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// State machine (remote flow)
// ---------------------------------------------------------------------------

type State =
  | { step: "endpoint"; endpoint: string }
  | { step: "probing"; endpoint: string }
  | { step: "probed"; endpoint: string; probe: McpProbeResult }
  | { step: "oauth-starting"; endpoint: string; probe: McpProbeResult }
  | {
      step: "oauth-waiting";
      endpoint: string;
      probe: McpProbeResult;
      sessionId: string;
    }
  | { step: "oauth-done"; endpoint: string; probe: McpProbeResult; tokens: McpOAuthTokens }
  | {
      step: "adding";
      endpoint: string;
      probe: McpProbeResult;
      tokens: McpOAuthTokens | null;
    }
  | {
      step: "error";
      endpoint: string;
      probe: McpProbeResult | null;
      tokens: McpOAuthTokens | null;
      error: string;
    };

type Action =
  | { type: "set-endpoint"; endpoint: string }
  | { type: "probe-start" }
  | { type: "probe-ok"; probe: McpProbeResult }
  | { type: "probe-fail"; error: string }
  | { type: "oauth-start" }
  | { type: "oauth-waiting"; sessionId: string }
  | { type: "oauth-ok"; tokens: McpOAuthTokens }
  | { type: "oauth-fail"; error: string }
  | { type: "oauth-cancelled" }
  | { type: "add-start" }
  | { type: "add-fail"; error: string }
  | { type: "retry" };

const init: State = { step: "endpoint", endpoint: "" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set-endpoint":
      return { step: "endpoint", endpoint: action.endpoint };

    case "probe-start":
      return { step: "probing", endpoint: state.endpoint };

    case "probe-ok":
      return { step: "probed", endpoint: state.endpoint, probe: action.probe };

    case "probe-fail":
      return {
        step: "error",
        endpoint: state.endpoint,
        probe: null,
        tokens: null,
        error: action.error,
      };

    case "oauth-start":
      if (state.step !== "probed" && state.step !== "error") return state;
      return {
        step: "oauth-starting",
        endpoint: state.endpoint,
        probe: state.step === "probed" ? state.probe : state.probe!,
      };

    case "oauth-waiting":
      if (state.step !== "oauth-starting") return state;
      return {
        step: "oauth-waiting",
        endpoint: state.endpoint,
        probe: state.probe,
        sessionId: action.sessionId,
      };

    case "oauth-ok":
      if (state.step !== "oauth-waiting") return state;
      return {
        step: "oauth-done",
        endpoint: state.endpoint,
        probe: state.probe,
        tokens: action.tokens,
      };

    case "oauth-fail":
      if (state.step !== "oauth-starting" && state.step !== "oauth-waiting") return state;
      return {
        step: "error",
        endpoint: state.endpoint,
        probe: state.probe,
        tokens: null,
        error: action.error,
      };

    case "oauth-cancelled":
      if (state.step !== "oauth-waiting") return state;
      return { step: "probed", endpoint: state.endpoint, probe: state.probe };

    case "add-start": {
      const tokens =
        state.step === "oauth-done" ? state.tokens : state.step === "probed" ? null : null;
      const probe = "probe" in state ? state.probe : null;
      if (!probe) return state;
      return { step: "adding", endpoint: state.endpoint, probe, tokens };
    }

    case "add-fail":
      if (state.step !== "adding") return state;
      return {
        step: "error",
        endpoint: state.endpoint,
        probe: state.probe,
        tokens: state.tokens,
        error: action.error,
      };

    case "retry": {
      if (state.step !== "error") return state;
      return state.probe
        ? state.tokens
          ? {
              step: "oauth-done",
              endpoint: state.endpoint,
              probe: state.probe,
              tokens: state.tokens,
            }
          : { step: "probed", endpoint: state.endpoint, probe: state.probe }
        : { step: "endpoint", endpoint: state.endpoint };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AddMcpSource(props: {
  onComplete: () => void;
  onCancel: () => void;
  initialUrl?: string;
  initialPreset?: string;
  /** Whether the stdio transport is enabled on the server. */
  allowStdio?: boolean;
}) {
  const allowStdio = props.allowStdio ?? false;
  const rawPreset = findPreset(props.initialPreset);
  const preset = rawPreset?.transport === "stdio" && !allowStdio ? undefined : rawPreset;
  const isStdioPreset = preset?.transport === "stdio";

  const [transport, setTransport] = useState<"remote" | "stdio">(
    isStdioPreset && allowStdio ? "stdio" : "remote",
  );
  const [activeTab, setActiveTab] = useState<"settings" | "operations">("settings");

  // --- Stdio state ---
  const [stdioCommand, setStdioCommand] = useState(isStdioPreset ? preset.command : "");
  const [stdioArgs, setStdioArgs] = useState(
    isStdioPreset && preset.args ? preset.args.join(" ") : "",
  );
  const [stdioEnv, setStdioEnv] = useState("");
  const [stdioAdding, setStdioAdding] = useState(false);
  const [stdioError, setStdioError] = useState<string | null>(null);

  // --- Remote state ---
  const remoteUrl =
    !isStdioPreset && preset?.transport === undefined && preset?.url
      ? preset.url
      : (props.initialUrl ?? "");

  const [state, dispatch] = useReducer(
    reducer,
    remoteUrl ? { step: "endpoint" as const, endpoint: remoteUrl } : init,
  );

  const scopeId = useScope();
  const doProbe = useAtomSet(probeMcpEndpoint, { mode: "promise" });
  const doAdd = useAtomSet(addMcpSource, { mode: "promise" });
  const doStartOAuth = useAtomSet(startMcpOAuth, { mode: "promise" });
  const secretList = useSecretPickerSecrets();

  const [authMode, setAuthMode] = useState<AuthMode>("bearer");
  const [bearerSecretId, setBearerSecretId] = useState<string | null>(null);
  const [apiKeyName, setApiKeyName] = useState<string>("");
  const [apiKeySecretId, setApiKeySecretId] = useState<string | null>(null);
  const [apiKeyLocation, setApiKeyLocation] = useState<"header" | "query">("header");
  const [headers, setHeaders] = useState<readonly KeyValueEntry[]>([]);

  const probe = "probe" in state ? state.probe : null;
  const tokens = "tokens" in state ? state.tokens : null;

  const oauthStatus: OAuthStatus = tokens
    ? { step: "authenticated" }
    : state.step === "oauth-starting"
      ? { step: "starting" }
      : state.step === "oauth-waiting"
        ? { step: "waiting" }
        : state.step === "error" && state.probe !== null && !tokens
          ? { step: "error", message: state.error }
          : { step: "idle" };

  // Single identity shared across remote+stdio transports — user-typed
  // overrides persist across tab switches, and the fallback is computed
  // from whichever transport is active.
  const identity = useSourceIdentity({
    fallbackName:
      transport === "stdio"
        ? isStdioPreset
          ? preset!.name
          : stdioCommand
        : (probe?.serverName ?? probe?.name ?? displayNameFromUrl(state.endpoint) ?? ""),
  });
  const probing = state.step === "probing";
  const adding = state.step === "adding";
  const isOAuthBusy = state.step === "oauth-starting" || state.step === "oauth-waiting";
  const headerAuthComplete = Boolean(bearerSecretId);
  const apiKeyAuthComplete = Boolean(apiKeySecretId) && apiKeyName.trim().length > 0;
  const headersComplete = headers.every(
    (entry) => entry.key.trim() && entry.value.trim(),
  );
  const authReady =
    authMode === "bearer"
      ? headerAuthComplete
      : authMode === "apikey"
        ? apiKeyAuthComplete
        : authMode === "none"
          ? true
          : tokens !== null;
  const canAdd = Boolean(probe) && authReady && headersComplete && !adding && !isOAuthBusy;
  // Single error surface — the reducer allows only one error at a time. The
  // render distinguishes "pre-probe failure" (inline, beneath the endpoint
  // input) from "post-probe failure" (banner, with retry) by checking whether
  // a probe result is present.
  const error = state.step === "error" ? state.error : null;
  const isProbeError = state.step === "error" && state.probe === null;

  // Tools as operations
  const toolEntries: OperationEntry[] = useMemo(() => {
    if (!probe) return [];
    return probe.tools.map((tool) => {
      const inputSchema = tool.inputSchema;
      const hasSchema = inputSchema !== undefined && inputSchema !== null;
      return {
        id: tool.name,
        path: tool.name,
        summary: tool.description,
        renderDetail: hasSchema
          ? () => {
              const ts = buildToolTypeScriptPreview({
                inputSchema,
                defs: new Map(),
              });
              const definitions = Object.entries(ts.typeScriptDefinitions ?? {}).map(
                ([name, code]) => ({ name, code }),
              );
              return (
                <OperationDetail
                  data={{
                    inputSchema,
                    inputTypeScript: ts.inputTypeScript
                      ? `type Input = ${ts.inputTypeScript}`
                      : null,
                    definitions,
                  }}
                />
              );
            }
          : undefined,
      };
    });
  }, [probe]);


  // ---- Remote actions ----

  const handleProbe = useCallback(async () => {
    dispatch({ type: "probe-start" });
    try {
      const result = await doProbe({
        path: { scopeId },
        payload: { endpoint: state.endpoint.trim() },
      });
      setAuthMode(result.requiresOAuth ? "oauth" : "bearer");
      dispatch({ type: "probe-ok", probe: result });
    } catch (e) {
      dispatch({
        type: "probe-fail",
        error: e instanceof Error ? e.message : "Failed to connect",
      });
    }
  }, [state.endpoint, scopeId, doProbe]);

  const handleProbeRef = useRef(handleProbe);
  handleProbeRef.current = handleProbe;

  useEffect(() => {
    if (transport !== "remote") return;
    if (state.step !== "endpoint") return;
    const trimmed = state.endpoint.trim();
    if (!trimmed) return;
    const handle = setTimeout(() => {
      handleProbeRef.current();
    }, 400);
    return () => clearTimeout(handle);
  }, [transport, state.step, state.endpoint]);

  const oauthCleanup = useRef<(() => void) | null>(null);

  const handleStartOAuth = useCallback(async () => {
    oauthCleanup.current?.();
    oauthCleanup.current = null;
    dispatch({ type: "oauth-start" });
    try {
      const redirectUrl = `${window.location.origin}/api/mcp/oauth/callback`;
      const result = await doStartOAuth({
        path: { scopeId },
        payload: { endpoint: state.endpoint.trim(), redirectUrl },
      });
      dispatch({ type: "oauth-waiting", sessionId: result.sessionId });
      oauthCleanup.current = openOAuthPopup<McpOAuthTokens>({
        url: result.authorizationUrl,
        popupName: MCP_OAUTH_POPUP_NAME,
        channelName: MCP_OAUTH_CHANNEL,
        onResult: (data: OAuthPopupResult<McpOAuthTokens>) => {
          oauthCleanup.current = null;
          if (data.ok) {
            dispatch({
              type: "oauth-ok",
              tokens: {
                accessTokenSecretId: data.accessTokenSecretId,
                refreshTokenSecretId: data.refreshTokenSecretId,
                tokenType: data.tokenType,
                expiresAt: data.expiresAt,
                scope: data.scope,
              },
            });
          } else {
            dispatch({ type: "oauth-fail", error: data.error });
          }
        },
        onClosed: () => {
          oauthCleanup.current = null;
          dispatch({
            type: "oauth-fail",
            error: "OAuth cancelled — popup was closed before completing the flow.",
          });
        },
        onOpenFailed: () => {
          oauthCleanup.current = null;
          dispatch({ type: "oauth-fail", error: "OAuth popup was blocked" });
        },
      });
    } catch (e) {
      dispatch({
        type: "oauth-fail",
        error: e instanceof Error ? e.message : "Failed to start OAuth",
      });
    }
  }, [state.endpoint, scopeId, doStartOAuth]);

  const handleCancelOAuth = useCallback(() => {
    oauthCleanup.current?.();
    oauthCleanup.current = null;
    dispatch({ type: "oauth-cancelled" });
  }, []);

  const handleAddRemote = useCallback(async () => {
    if (!probe) return;
    dispatch({ type: "add-start" });
    try {
      const trimmedApiKeyName = apiKeyName.trim();
      const auth =
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
            : authMode === "oauth" && tokens
              ? {
                  kind: "oauth2" as const,
                  accessTokenSecretId: tokens.accessTokenSecretId,
                  refreshTokenSecretId: tokens.refreshTokenSecretId,
                  tokenType: tokens.tokenType,
                  expiresAt: tokens.expiresAt,
                  scope: tokens.scope,
                }
              : { kind: "none" as const };
      const headersRecord = Object.fromEntries(
        headers
          .map((entry) => [entry.key.trim(), entry.value.trim()] as const)
          .filter(([name, value]) => name && value),
      );

      await doAdd({
        path: { scopeId },
        payload: {
          transport: "remote" as const,
          name: identity.name.trim() || probe.serverName || probe.name,
          namespace: slugifyNamespace(identity.namespace) || undefined,
          endpoint: state.endpoint.trim(),
          auth,
          ...(Object.keys(headersRecord).length > 0 ? { headers: headersRecord } : {}),
        },
      });
      props.onComplete();
    } catch (e) {
      dispatch({
        type: "add-fail",
        error: e instanceof Error ? e.message : "Failed to add source",
      });
    }
  }, [
    probe,
    authMode,
    bearerSecretId,
    apiKeyName,
    apiKeySecretId,
    apiKeyLocation,
    headers,
    identity,
    tokens,
    state.endpoint,
    doAdd,
    props,
    scopeId,
  ]);

  // ---- Stdio actions ----

  const parseStdioArgs = (raw: string): string[] => {
    if (!raw.trim()) return [];
    const args: string[] = [];
    const regex = /[^\s"]+|"([^"]*)"/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      args.push(match[1] ?? match[0]);
    }
    return args;
  };

  const parseStdioEnv = (raw: string): Record<string, string> | undefined => {
    if (!raw.trim()) return undefined;
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    return Object.keys(env).length > 0 ? env : undefined;
  };

  const handleAddStdio = useCallback(async () => {
    const cmd = stdioCommand.trim();
    if (!cmd) return;
    setStdioAdding(true);
    setStdioError(null);
    try {
      await doAdd({
        path: { scopeId },
        payload: {
          transport: "stdio" as const,
          name: identity.name.trim() || cmd,
          namespace: slugifyNamespace(identity.namespace) || undefined,
          command: cmd,
          args: parseStdioArgs(stdioArgs),
          env: parseStdioEnv(stdioEnv),
        },
      });
      props.onComplete();
    } catch (e) {
      setStdioError(e instanceof Error ? e.message : "Failed to add source");
      setStdioAdding(false);
    }
  }, [stdioCommand, stdioArgs, stdioEnv, identity, doAdd, scopeId, props]);

  // ---- Render ----

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/">Sources</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Add MCP</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <FilterTabs
        tabs={[
          { label: "Settings", value: "settings" as const },
          {
            label: "Operations",
            value: "operations" as const,
            count: transport === "remote" ? (probe?.toolCount ?? undefined) : undefined,
          },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "settings" && transport === "remote" && (
        <div className="space-y-6">
          {/* Name, Namespace */}
          <SourceIdentityFields
            identity={identity}
            namePlaceholder="e.g. Linear"
          />

          {/* Transport + URL */}
          <CardStack>
            <CardStackContent className="border-t-0">
              {allowStdio && (
                <CardStackEntryField
                  label="Transport"
                  labelAction={
                    <Tabs value={transport} onValueChange={(v) => setTransport(v as "remote" | "stdio")}>
                      <TabsList>
                        <TabsTrigger value="remote">Remote HTTP</TabsTrigger>
                        <TabsTrigger value="stdio">Standard I/O</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  }
                />
              )}
              <CardStackEntryField
                label="URL"
                labelAction={probing ? <IOSSpinner className="size-4" /> : undefined}
              >
                <Input
                  value={state.endpoint}
                  onChange={(e) => dispatch({ type: "set-endpoint", endpoint: (e.target as HTMLInputElement).value })}
                  placeholder="https://mcp.example.com"
                  className="w-full font-mono text-sm"
                />
                {error && isProbeError && <FieldError>{error}</FieldError>}
              </CardStackEntryField>
            </CardStackContent>
          </CardStack>

          {/* Authentication & Headers */}
          {probe && (
            <SourceConfig
              authMode={authMode}
              onAuthModeChange={setAuthMode}
              allowedAuthModes={["none", "apikey", "bearer", "oauth"]}
              bearerSecretId={bearerSecretId}
              onBearerSecretChange={setBearerSecretId}
              apiKeyName={apiKeyName}
              onApiKeyNameChange={setApiKeyName}
              apiKeySecretId={apiKeySecretId}
              onApiKeySecretChange={setApiKeySecretId}
              apiKeyLocation={apiKeyLocation}
              onApiKeyLocationChange={setApiKeyLocation}
              oauthStatus={oauthStatus}
              onOAuthSignIn={handleStartOAuth}
              onOAuthCancel={handleCancelOAuth}
              headers={headers}
              onHeadersChange={setHeaders}
              secrets={secretList}
            />
          )}

          {/* Error */}
          {error && !isProbeError && (
            <div className="space-y-2">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-[12px] text-destructive">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: "retry" })}
                className="text-xs"
              >
                Try again
              </Button>
            </div>
          )}
        </div>
      )}

      {activeTab === "settings" && transport === "stdio" && (
        <div className="space-y-6">
          {/* Name, Namespace */}
          <SourceIdentityFields
            identity={identity}
            namePlaceholder="My MCP Server"
          />

          {/* Transport + Command + Args + Env in one card stack */}
          <CardStack>
            <CardStackContent className="border-t-0">
              {allowStdio && (
                <CardStackEntryField
                  label="Transport"
                  labelAction={
                    <Tabs value={transport} onValueChange={(v) => setTransport(v as "remote" | "stdio")}>
                      <TabsList>
                        <TabsTrigger value="remote">Remote HTTP</TabsTrigger>
                        <TabsTrigger value="stdio">Standard I/O</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  }
                />
              )}
              <CardStackEntryField label="Command">
                <Input
                  value={stdioCommand}
                  onChange={(e) => setStdioCommand((e.target as HTMLInputElement).value)}
                  placeholder="npx"
                  className="font-mono text-sm"
                />
              </CardStackEntryField>

              <CardStackEntryField label="Arguments">
                <Input
                  value={stdioArgs}
                  onChange={(e) => setStdioArgs((e.target as HTMLInputElement).value)}
                  placeholder="-y chrome-devtools-mcp@latest"
                  className="font-mono text-sm"
                />
              </CardStackEntryField>

              <CardStackEntryField label="Environment Variables">
                <Textarea
                  value={stdioEnv}
                  onChange={(e) => setStdioEnv((e.target as HTMLTextAreaElement).value)}
                  placeholder={"KEY=value\nANOTHER=value"}
                  rows={3}
                  maxRows={10}
                  className="font-mono text-sm"
                />
              </CardStackEntryField>
            </CardStackContent>
          </CardStack>

          {/* Stdio error */}
          {stdioError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-[12px] text-destructive">{stdioError}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "operations" && (
        <SourceOperations
          operations={toolEntries}
          emptyLabel="No tools discovered"
        />
      )}

      <FloatActions>
        <Button
          variant="ghost"
          onClick={props.onCancel}
          disabled={transport === "remote" ? adding : stdioAdding}
        >
          Cancel
        </Button>
        {transport === "remote" ? (
          <Button onClick={handleAddRemote} disabled={!canAdd}>
            {adding ? (
              <>
                <Spinner className="size-3.5" /> Adding…
              </>
            ) : (
              "Add source"
            )}
          </Button>
        ) : (
          <Button onClick={handleAddStdio} disabled={!stdioCommand.trim() || stdioAdding}>
            {stdioAdding ? (
              <>
                <Spinner className="size-3.5" /> Adding…
              </>
            ) : (
              "Add source"
            )}
          </Button>
        )}
      </FloatActions>
    </div>
  );
}
