import { startTransition, useMemo, useState } from "react";
import type { Source } from "@executor/react";
import {
  defineExecutorPluginHttpApiClient,
  Result,
  useAtomSet,
  useAtomValue,
  useExecutorMutation,
  useLocalInstallation,
  useSecrets,
} from "@executor/react";
import {
  IconPencil,
  SourceToolExplorer,
  defineExecutorFrontendPlugin,
  defineFrontendSourceType,
  parseSourceToolExplorerSearch,
  type SourceToolExplorerSearch,
  useSourcePluginNavigation,
  useSourcePluginSearch,
} from "@executor/react/plugins";

import {
  googleDiscoveryHttpApiExtension,
} from "@executor/plugin-google-discovery-http";
import {
  GOOGLE_DISCOVERY_OAUTH_CALLBACK_PATH,
  GOOGLE_DISCOVERY_OAUTH_STORAGE_PREFIX,
  GOOGLE_DISCOVERY_PLUGIN_KEY,
  GOOGLE_DISCOVERY_SOURCE_KIND,
  defaultGoogleDiscoveryUrl,
  type GoogleDiscoveryConnectInput,
  type GoogleDiscoveryConnectionAuth,
  type GoogleDiscoveryOAuthPopupResult,
  type GoogleDiscoveryStartOAuthInput,
} from "@executor/plugin-google-discovery-shared";

const OAUTH_TIMEOUT_MS = 2 * 60_000;

const GOOGLE_DISCOVERY_SERVICE_ICONS: Record<string, string> = {
  admin: "https://ssl.gstatic.com/images/branding/product/2x/admin_2020q4_48dp.png",
  bigquery: "https://ssl.gstatic.com/bqui1/favicon.ico",
  calendar: "https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png",
  chat: "https://ssl.gstatic.com/chat/favicon/favicon_v2.ico",
  classroom: "https://ssl.gstatic.com/classroom/favicon.png",
  cloudresourcemanager: "https://www.gstatic.com/devrel-devsite/prod/v0e0f589edd85502a40d78d7d0825db8ea5ef3b99b1571571945f0f3f764ff61b/cloud/images/favicons/onecloud/favicon.ico",
  docs: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico",
  drive: "https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
  forms: "https://ssl.gstatic.com/docs/forms/device_home/android_192.png",
  gmail: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico",
  keep: "https://ssl.gstatic.com/keep/icon_2020q4v2_128.png",
  people: "https://ssl.gstatic.com/images/branding/product/2x/contacts_2022_48dp.png",
  script: "https://ssl.gstatic.com/script/images/favicon.ico",
  searchconsole: "https://ssl.gstatic.com/search-console/scfe/search_console-64.png",
  sheets: "https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico",
  slides: "https://ssl.gstatic.com/docs/presentations/images/favicon5.ico",
  tasks: "https://ssl.gstatic.com/tasks/images/favicon.ico",
  youtube: "https://www.youtube.com/s/desktop/a94e1818/img/favicon_32x32.png",
};

const getGoogleDiscoveryServiceKey = (
  source: Pick<Source, "namespace">,
): string | null => {
  const namespace = source.namespace?.trim();
  if (!namespace || !namespace.startsWith("google.")) {
    return null;
  }

  return namespace.slice("google.".length).replaceAll(".", "");
};

const getGoogleDiscoveryIconUrl = (
  source: Pick<Source, "namespace">,
): string | null => {
  const serviceKey = getGoogleDiscoveryServiceKey(source);
  return serviceKey ? GOOGLE_DISCOVERY_SERVICE_ICONS[serviceKey] ?? null : null;
};

const getGoogleDiscoveryHttpClient =
  defineExecutorPluginHttpApiClient<"GoogleDiscoveryReactHttpClient">()(
    "GoogleDiscoveryReactHttpClient",
    [googleDiscoveryHttpApiExtension] as const,
  );

const defaultGoogleInput = (): GoogleDiscoveryConnectInput => ({
  name: "Google Sheets",
  service: "sheets",
  version: "v4",
  discoveryUrl: defaultGoogleDiscoveryUrl("sheets", "v4"),
  defaultHeaders: null,
  scopes: [],
  auth: {
    kind: "none",
  },
});

const stringifyStringMap = (
  value: Record<string, string> | null | undefined,
): string =>
  !value || Object.keys(value).length === 0
    ? ""
    : JSON.stringify(value, null, 2);

const parseStringMap = (value: string): Record<string, string> | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object.");
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.every(([, entry]) => typeof entry === "string")) {
    throw new Error("All header values must be strings.");
  }

  return Object.fromEntries(entries as Array<[string, string]>);
};

const stringifyScopes = (value: ReadonlyArray<string>): string =>
  value.join("\n");

const parseScopes = (value: string): Array<string> =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const authSecretValue = (
  input: GoogleDiscoveryConnectionAuth,
): string =>
  input.kind === "bearer"
    ? JSON.stringify(input.tokenSecretRef)
    : "";

const clientSecretValue = (
  input: GoogleDiscoveryConnectionAuth,
): string =>
  input.kind === "oauth2" && input.clientSecretRef
    ? JSON.stringify(input.clientSecretRef)
    : "";

const waitForOauthPopupResult = async (
  sessionId: string,
): Promise<GoogleDiscoveryOAuthPopupResult> =>
  new Promise((resolve, reject) => {
    const storageKey = `${GOOGLE_DISCOVERY_OAUTH_STORAGE_PREFIX}${sessionId}`;
    const startedAt = Date.now();

    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(intervalId);
    };

    const finish = (result: GoogleDiscoveryOAuthPopupResult) => {
      cleanup();
      try {
        window.localStorage.removeItem(storageKey);
      } catch {}
      resolve(result);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as GoogleDiscoveryOAuthPopupResult | undefined;
      if (!data || data.type !== "executor:oauth-result") {
        return;
      }

      if (data.ok && data.sessionId !== sessionId) {
        return;
      }

      finish(data);
    };

    window.addEventListener("message", handleMessage);
    const intervalId = window.setInterval(() => {
      if (Date.now() - startedAt > OAUTH_TIMEOUT_MS) {
        cleanup();
        reject(new Error("Timed out waiting for Google OAuth to finish."));
        return;
      }

      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          return;
        }

        finish(JSON.parse(raw) as GoogleDiscoveryOAuthPopupResult);
      } catch {
        // Ignore malformed local storage and continue polling.
      }
    }, 400);
  });

function GoogleDiscoverySourceForm(props: {
  initialValue: GoogleDiscoveryConnectInput;
  mode: "create" | "edit";
  onSubmit: (input: GoogleDiscoveryConnectInput) => Promise<void>;
}) {
  const installation = useLocalInstallation();
  const client = getGoogleDiscoveryHttpClient();
  const secrets = useSecrets();
  const startOAuth = useAtomSet(
    client.mutation(GOOGLE_DISCOVERY_PLUGIN_KEY, "startOAuth"),
    { mode: "promise" },
  );
  const submitMutation = useExecutorMutation<GoogleDiscoveryConnectInput, void>(props.onSubmit);
  const [name, setName] = useState(props.initialValue.name);
  const [service, setService] = useState(props.initialValue.service);
  const [version, setVersion] = useState(props.initialValue.version);
  const [discoveryUrl, setDiscoveryUrl] = useState(props.initialValue.discoveryUrl ?? "");
  const [headersText, setHeadersText] = useState(
    stringifyStringMap(props.initialValue.defaultHeaders),
  );
  const [scopesText, setScopesText] = useState(
    stringifyScopes(props.initialValue.scopes),
  );
  const [authKind, setAuthKind] = useState<GoogleDiscoveryConnectionAuth["kind"]>(
    props.initialValue.auth.kind,
  );
  const [bearerSecretRef, setBearerSecretRef] = useState(
    authSecretValue(props.initialValue.auth),
  );
  const [clientId, setClientId] = useState(
    props.initialValue.auth.kind === "oauth2" ? props.initialValue.auth.clientId : "",
  );
  const [clientSecretRef, setClientSecretRef] = useState(
    clientSecretValue(props.initialValue.auth),
  );
  const [oauthAuth, setOauthAuth] = useState<
    Extract<GoogleDiscoveryConnectionAuth, { kind: "oauth2" }> | null
  >(props.initialValue.auth.kind === "oauth2" ? props.initialValue.auth : null);
  const [error, setError] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "pending" | "connected">(
    props.initialValue.auth.kind === "oauth2" ? "connected" : "idle",
  );

  const runOauth = async () => {
    if (installation.status !== "ready") {
      throw new Error("Workspace is still loading.");
    }

    const payload: GoogleDiscoveryStartOAuthInput = {
      service: service.trim(),
      version: version.trim(),
      discoveryUrl: discoveryUrl.trim() || null,
      defaultHeaders: parseStringMap(headersText),
      scopes: parseScopes(scopesText),
      clientId: clientId.trim(),
      clientSecretRef: clientSecretRef
        ? JSON.parse(clientSecretRef)
        : null,
      clientAuthentication: clientSecretRef ? "client_secret_post" : "none",
      redirectUrl: new URL(
        GOOGLE_DISCOVERY_OAUTH_CALLBACK_PATH,
        window.location.origin,
      ).toString(),
    };

    const started = await startOAuth({
      path: {
        workspaceId: installation.data.scopeId,
      },
      payload,
    });

    const popup = window.open(
      started.authorizationUrl,
      "executor-google-discovery-oauth",
      "width=560,height=760,noopener,noreferrer",
    );
    if (!popup) {
      throw new Error("Failed opening Google OAuth popup.");
    }

    const result = await waitForOauthPopupResult(started.sessionId);
    if (!result.ok) {
      throw new Error(result.error);
    }

    setScopesText(stringifyScopes(result.auth.scopes));
    setOauthAuth(result.auth);
    setOauthStatus("connected");
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {props.mode === "create"
            ? "Connect Google Discovery Source"
            : "Edit Google Discovery Source"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Google Discovery now owns its API metadata and OAuth flow inside the plugin.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Service</span>
          <input
            value={service}
            onChange={(event) => setService(event.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Version</span>
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Discovery URL</span>
          <input
            value={discoveryUrl}
            onChange={(event) => setDiscoveryUrl(event.target.value)}
            placeholder={defaultGoogleDiscoveryUrl(service || "sheets", version || "v4")}
            className="h-10 rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
          />
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Default Headers</span>
        <textarea
          value={headersText}
          onChange={(event) => setHeadersText(event.target.value)}
          rows={4}
          className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Scopes</span>
        <textarea
          value={scopesText}
          onChange={(event) => setScopesText(event.target.value)}
          rows={4}
          placeholder="Leave blank to infer from the discovery document."
          className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Auth</span>
        <select
          value={authKind}
          onChange={(event) =>
            setAuthKind(event.target.value as GoogleDiscoveryConnectionAuth["kind"])}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
        >
          <option value="none">None</option>
          <option value="bearer">Bearer Secret</option>
          <option value="oauth2">Google OAuth</option>
        </select>
      </label>

      {authKind === "bearer" && (
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Secret</span>
          <select
            value={bearerSecretRef}
            onChange={(event) => setBearerSecretRef(event.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
          >
            <option value="">Select a secret</option>
            {secrets.status === "ready" &&
              secrets.data.map((secret) => (
                <option
                  key={`${secret.providerId}:${secret.id}`}
                  value={JSON.stringify({
                    providerId: secret.providerId,
                    handle: secret.id,
                  })}
                >
                  {secret.name ?? secret.id}
                </option>
              ))}
          </select>
        </label>
      )}

      {authKind === "oauth2" && (
        <div className="space-y-4 rounded-xl border border-border/70 bg-background/50 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Client ID</span>
            <input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Client Secret</span>
            <select
              value={clientSecretRef}
              onChange={(event) => setClientSecretRef(event.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
            >
              <option value="">Public client / no secret</option>
              {secrets.status === "ready" &&
                secrets.data.map((secret) => (
                  <option
                    key={`${secret.providerId}:${secret.id}`}
                    value={JSON.stringify({
                      providerId: secret.providerId,
                      handle: secret.id,
                    })}
                  >
                    {secret.name ?? secret.id}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  setError(null);
                  setOauthStatus("pending");
                  try {
                    await runOauth();
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Google OAuth failed.");
                    setOauthStatus("idle");
                    return;
                  }
                })();
              }}
              disabled={oauthStatus === "pending"}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-50"
            >
              {oauthStatus === "pending"
                ? "Connecting..."
                : oauthStatus === "connected"
                  ? "Reconnect OAuth"
                  : "Connect OAuth"}
            </button>
            <div className="text-xs text-muted-foreground">
              {oauthStatus === "connected"
                ? "OAuth tokens are ready and will be saved with this source."
                : "The plugin opens Google OAuth in a popup and stores token refs locally."}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              setError(null);
              try {
                const auth: GoogleDiscoveryConnectionAuth =
                  authKind === "none"
                    ? { kind: "none" }
                    : authKind === "bearer"
                      ? {
                          kind: "bearer",
                          tokenSecretRef: JSON.parse(bearerSecretRef),
                        }
                      : oauthAuth
                        ? oauthAuth
                        : (() => {
                            throw new Error("Finish Google OAuth before saving.");
                          })();

                await submitMutation.mutateAsync({
                  name: name.trim(),
                  service: service.trim(),
                  version: version.trim(),
                  discoveryUrl: discoveryUrl.trim() || null,
                  defaultHeaders: parseStringMap(headersText),
                  scopes: parseScopes(scopesText),
                  auth,
                });
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Failed saving Google Discovery source.",
                );
              }
            })();
          }}
          disabled={submitMutation.status === "pending"}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity disabled:pointer-events-none disabled:opacity-50"
        >
          {submitMutation.status === "pending"
            ? props.mode === "create" ? "Creating..." : "Saving..."
            : props.mode === "create" ? "Create Source" : "Save Changes"}
        </button>
        <div className="text-xs text-muted-foreground">
          {props.mode === "create"
            ? "The discovery document is imported as soon as the source is created."
            : "Saving refreshes the imported Google API model."}
        </div>
      </div>
    </div>
  );
}

function GoogleDiscoveryAddPage() {
  const navigation = useSourcePluginNavigation();
  const installation = useLocalInstallation();
  const client = getGoogleDiscoveryHttpClient();
  const createSource = useAtomSet(
    client.mutation(GOOGLE_DISCOVERY_PLUGIN_KEY, "createSource"),
    { mode: "promise" },
  );

  if (installation.status !== "ready") {
    return <div className="text-sm text-muted-foreground">Loading workspace...</div>;
  }

  return (
    <GoogleDiscoverySourceForm
      initialValue={defaultGoogleInput()}
      mode="create"
      onSubmit={async (input) => {
        const source = await createSource({
          path: {
            workspaceId: installation.data.scopeId,
          },
          payload: input,
          reactivityKeys: {
            sources: [installation.data.scopeId],
          },
        });

        startTransition(() => {
          void navigation.detail(source.id, {
            tab: "model",
          });
        });
      }}
    />
  );
}

function GoogleDiscoveryEditPage(props: {
  source: Source;
}) {
  const navigation = useSourcePluginNavigation();
  const installation = useLocalInstallation();
  const client = getGoogleDiscoveryHttpClient();
  const configResult = useAtomValue(
    installation.status === "ready"
      ? client.query(GOOGLE_DISCOVERY_PLUGIN_KEY, "getSourceConfig", {
          path: {
            workspaceId: installation.data.scopeId,
            sourceId: props.source.id,
          },
          reactivityKeys: {
            source: [installation.data.scopeId, props.source.id],
          },
          timeToLive: "30 seconds",
        })
      : client.query("local", "installation", {
          timeToLive: "1 second",
        }) as never,
  );
  const updateSource = useAtomSet(
    client.mutation(GOOGLE_DISCOVERY_PLUGIN_KEY, "updateSource"),
    { mode: "promise" },
  );

  if (installation.status !== "ready") {
    return <div className="text-sm text-muted-foreground">Loading workspace...</div>;
  }

  if (Result.isFailure(configResult)) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
        Failed loading Google Discovery config.
      </div>
    );
  }

  if (!Result.isSuccess(configResult)) {
    return <div className="text-sm text-muted-foreground">Loading Google Discovery config...</div>;
  }

  return (
    <GoogleDiscoverySourceForm
      initialValue={configResult.value}
      mode="edit"
      onSubmit={async (input) => {
        const source = await updateSource({
          path: {
            workspaceId: installation.data.scopeId,
            sourceId: props.source.id,
          },
          payload: input,
          reactivityKeys: {
            sources: [installation.data.scopeId],
            source: [installation.data.scopeId, props.source.id],
            sourceInspection: [installation.data.scopeId, props.source.id],
            sourceInspectionTool: [installation.data.scopeId, props.source.id],
            sourceDiscovery: [installation.data.scopeId, props.source.id],
          },
        });

        startTransition(() => {
          void navigation.detail(source.id, {
            tab: "model",
          });
        });
      }}
    />
  );
}

function GoogleDiscoveryDetailPage(props: {
  source: Source;
}) {
  const navigation = useSourcePluginNavigation();
  const search = parseSourceToolExplorerSearch(
    useSourcePluginSearch(),
  ) satisfies SourceToolExplorerSearch;
  const installation = useLocalInstallation();
  const client = getGoogleDiscoveryHttpClient();
  const removeSource = useAtomSet(
    client.mutation(GOOGLE_DISCOVERY_PLUGIN_KEY, "removeSource"),
    { mode: "promise" },
  );
  const configResult = useAtomValue(
    installation.status === "ready"
      ? client.query(GOOGLE_DISCOVERY_PLUGIN_KEY, "getSourceConfig", {
          path: {
            workspaceId: installation.data.scopeId,
            sourceId: props.source.id,
          },
          reactivityKeys: {
            source: [installation.data.scopeId, props.source.id],
          },
          timeToLive: "30 seconds",
        })
      : client.query("local", "installation", {
          timeToLive: "1 second",
        }) as never,
  );
  const summary = useMemo(() => {
    if (!Result.isSuccess(configResult)) {
      return null;
    }

    const config = configResult.value;
    return (
      <div className="space-y-1">
        <div className="font-mono text-xs text-foreground">
          {config.discoveryUrl ?? defaultGoogleDiscoveryUrl(config.service, config.version)}
        </div>
        <div>
          API: <span className="text-foreground">{config.service} {config.version}</span>
        </div>
        <div>
          Auth: <span className="text-foreground">{config.auth.kind}</span>
        </div>
      </div>
    );
  }, [configResult]);

  if (installation.status !== "ready") {
    return <div className="text-sm text-muted-foreground">Loading workspace...</div>;
  }

  return (
    <SourceToolExplorer
      sourceId={props.source.id}
      title={props.source.name}
      kind={props.source.kind}
      search={search}
      navigate={(next) => navigation.updateSearch(next)}
      summary={summary}
      actions={(
        <>
          <button
            type="button"
            onClick={() =>
              void navigation.edit(props.source.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
          >
            <IconPencil className="size-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              const confirmed = window.confirm(
                `Delete Google Discovery source "${props.source.name}"?`,
              );
              if (!confirmed) {
                return;
              }

              void removeSource({
                path: {
                  workspaceId: installation.data.scopeId,
                  sourceId: props.source.id,
                },
                reactivityKeys: {
                  sources: [installation.data.scopeId],
                  source: [installation.data.scopeId, props.source.id],
                  sourceInspection: [installation.data.scopeId, props.source.id],
                  sourceInspectionTool: [installation.data.scopeId, props.source.id],
                  sourceDiscovery: [installation.data.scopeId, props.source.id],
                },
              }).then(() => {
                startTransition(() => {
                  void navigation.home();
                });
              });
            }}
            className="inline-flex h-9 items-center rounded-lg border border-destructive/25 bg-destructive/5 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            Delete
          </button>
        </>
      )}
    />
  );
}

const googleDiscoverySourceType = defineFrontendSourceType({
  key: GOOGLE_DISCOVERY_PLUGIN_KEY,
  kind: GOOGLE_DISCOVERY_SOURCE_KIND,
  displayName: "Google Discovery",
  description: "Import Google APIs from discovery documents with plugin-owned OAuth.",
  getIconUrl: getGoogleDiscoveryIconUrl,
  renderAddPage: GoogleDiscoveryAddPage,
  renderEditPage: GoogleDiscoveryEditPage,
  renderDetailPage: GoogleDiscoveryDetailPage,
});

export const GoogleDiscoveryReactPlugin = defineExecutorFrontendPlugin({
  key: GOOGLE_DISCOVERY_PLUGIN_KEY,
  sourceTypes: [googleDiscoverySourceType],
});
