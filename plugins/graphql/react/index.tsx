import { startTransition, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type {
  Source,
} from "@executor/react";
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
  graphqlHttpApiExtension,
} from "@executor/plugin-graphql-http";
import {
  type GraphqlConnectInput,
  type GraphqlConnectionAuth,
} from "@executor/plugin-graphql-shared";
import { SourceToolExplorer } from "../../../apps/web/src/source-plugins/tool-explorer";
import { IconPencil } from "../../../apps/web/src/components/icons";

type FrontendSourceTypeDefinition = {
  kind: string;
  displayName: string;
  description?: string;
  renderAddPage: () => ReactNode;
  renderEditPage?: (input: { source: Source }) => ReactNode;
  renderDetailPage?: (input: {
    source: Source;
    route: {
      search?: unknown;
      navigate?: unknown;
    };
  }) => ReactNode;
};

type FrontendPluginRegisterApi = {
  sources: {
    registerType: (definition: FrontendSourceTypeDefinition) => void;
  };
};

type RouteToolSearch = {
  tab?: "model" | "discover";
  tool?: string;
  query?: string;
};

const getGraphqlHttpClient = defineExecutorPluginHttpApiClient<"GraphqlReactHttpClient">()(
  "GraphqlReactHttpClient",
  [graphqlHttpApiExtension] as const,
);

const defaultGraphqlInput = (): GraphqlConnectInput => ({
  name: "My GraphQL Source",
  endpoint: "https://example.com/graphql",
  defaultHeaders: null,
  auth: {
    kind: "none",
  },
});

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

const stringifyStringMap = (
  value: Record<string, string> | null | undefined,
): string =>
  !value || Object.keys(value).length === 0
    ? ""
    : JSON.stringify(value, null, 2);

const secretValue = (input: GraphqlConnectionAuth): string =>
  input.kind === "bearer"
    ? JSON.stringify(input.tokenSecretRef)
    : "";

const authFromSecretValue = (
  authKind: GraphqlConnectionAuth["kind"],
  value: string,
): GraphqlConnectionAuth => {
  if (authKind === "none") {
    return {
      kind: "none",
    };
  }

  if (!value) {
    throw new Error("Select a secret for bearer auth.");
  }

  return {
    kind: "bearer",
    tokenSecretRef: JSON.parse(value) as GraphqlConnectionAuth & { tokenSecretRef: never }["tokenSecretRef"],
  };
};

function GraphqlSourceForm(props: {
  initialValue: GraphqlConnectInput;
  mode: "create" | "edit";
  onSubmit: (input: GraphqlConnectInput) => Promise<void>;
}) {
  const secrets = useSecrets();
  const submitMutation = useExecutorMutation<GraphqlConnectInput, void>(props.onSubmit);
  const [name, setName] = useState(props.initialValue.name);
  const [endpoint, setEndpoint] = useState(props.initialValue.endpoint);
  const [headersText, setHeadersText] = useState(
    stringifyStringMap(props.initialValue.defaultHeaders),
  );
  const [authKind, setAuthKind] = useState<GraphqlConnectionAuth["kind"]>(
    props.initialValue.auth.kind,
  );
  const [secretRef, setSecretRef] = useState(secretValue(props.initialValue.auth));
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {props.mode === "create" ? "Connect GraphQL Source" : "Edit GraphQL Source"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          GraphQL is now mounted as a plugin. The source record stays generic; endpoint and auth
          live entirely in plugin storage.
        </p>
      </div>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Endpoint</span>
        <input
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Default Headers</span>
        <textarea
          value={headersText}
          onChange={(event) => setHeadersText(event.target.value)}
          rows={5}
          placeholder='{"x-api-version":"2026-03-23"}'
          className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Auth</span>
        <select
          value={authKind}
          onChange={(event) =>
            setAuthKind(event.target.value as GraphqlConnectionAuth["kind"])}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
        >
          <option value="none">None</option>
          <option value="bearer">Bearer Secret</option>
        </select>
      </label>

      {authKind === "bearer" && (
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Secret</span>
          <select
            value={secretRef}
            onChange={(event) => setSecretRef(event.target.value)}
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
                await submitMutation.mutateAsync({
                  name: name.trim(),
                  endpoint: endpoint.trim(),
                  defaultHeaders: parseStringMap(headersText),
                  auth: authFromSecretValue(authKind, secretRef),
                });
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Failed saving GraphQL source.");
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
            ? "The plugin will introspect the endpoint immediately after creation."
            : "Saving refreshes the imported schema and tool catalog."}
        </div>
      </div>
    </div>
  );
}

function GraphqlAddPage() {
  const navigate = useNavigate();
  const installation = useLocalInstallation();
  const client = getGraphqlHttpClient();
  const createSource = useAtomSet(
    client.mutation("graphql", "createSource"),
    { mode: "promise" },
  );

  if (installation.status !== "ready") {
    return <div className="text-sm text-muted-foreground">Loading workspace...</div>;
  }

  return (
    <GraphqlSourceForm
      initialValue={defaultGraphqlInput()}
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
          void navigate({
            to: "/sources/$sourceId",
            params: {
              sourceId: source.id,
            },
            search: {
              tab: "model",
            },
          });
        });
      }}
    />
  );
}

function GraphqlEditPage(props: {
  source: Source;
}) {
  const navigate = useNavigate();
  const installation = useLocalInstallation();
  const client = getGraphqlHttpClient();
  const configResult = useAtomValue(
    installation.status === "ready"
      ? client.query("graphql", "getSourceConfig", {
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
    client.mutation("graphql", "updateSource"),
    { mode: "promise" },
  );

  if (installation.status !== "ready") {
    return <div className="text-sm text-muted-foreground">Loading workspace...</div>;
  }

  if (Result.isFailure(configResult)) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
        Failed loading GraphQL config.
      </div>
    );
  }

  if (!Result.isSuccess(configResult)) {
    return <div className="text-sm text-muted-foreground">Loading GraphQL config...</div>;
  }

  return (
    <GraphqlSourceForm
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
          void navigate({
            to: "/sources/$sourceId",
            params: {
              sourceId: source.id,
            },
            search: {
              tab: "model",
            },
          });
        });
      }}
    />
  );
}

function GraphqlDetailPage(props: {
  source: Source;
  route: {
    search?: unknown;
    navigate?: unknown;
  };
}) {
  const navigate = useNavigate();
  const installation = useLocalInstallation();
  const client = getGraphqlHttpClient();
  const removeSource = useAtomSet(
    client.mutation("graphql", "removeSource"),
    { mode: "promise" },
  );
  const configResult = useAtomValue(
    installation.status === "ready"
      ? client.query("graphql", "getSourceConfig", {
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
        <div className="font-mono text-xs text-foreground">{config.endpoint}</div>
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
      search={(props.route.search ?? {}) as RouteToolSearch}
      navigate={(next) => {
        const routeNavigate = props.route.navigate as
          | ((input: {
              search: {
                tab: "model" | "discover";
                tool?: string;
                query?: string;
              };
            }) => void | Promise<void>)
          | undefined;
        if (routeNavigate) {
          void routeNavigate({ search: next });
        }
      }}
      summary={summary}
      actions={(
        <>
          <button
            type="button"
            onClick={() =>
              void navigate({
                to: "/sources/$sourceId/edit",
                params: {
                  sourceId: props.source.id,
                },
              })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
          >
            <IconPencil className="size-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              const confirmed = window.confirm(`Delete GraphQL source "${props.source.name}"?`);
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
                  void navigate({
                    to: "/",
                  });
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

export const GraphqlReactPlugin = {
  key: "graphql",
  register(api: FrontendPluginRegisterApi) {
    api.sources.registerType({
      kind: "graphql",
      displayName: "GraphQL",
      description: "Introspect a GraphQL endpoint into typed query and mutation tools.",
      renderAddPage: () => <GraphqlAddPage />,
      renderEditPage: ({ source }) => <GraphqlEditPage source={source} />,
      renderDetailPage: ({ source, route }) => (
        <GraphqlDetailPage source={source} route={route} />
      ),
    });
  },
};
