import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSource } from "@executor/react";
import {
  ExecutorPluginRouteProvider,
  LoadableBlock,
  SourcePluginRouteProvider,
  createSourcePluginPaths,
  type ExecutorPluginNavigation,
  type FrontendPluginRouteDefinition,
  type FrontendPluginRouteParams,
  type FrontendPluginRouteSearch,
  type FrontendSourceDetailRouteDefinition,
  type SourcePluginNavigation,
  type SourcePluginRouteParams,
  type SourcePluginRouteSearch,
} from "@executor/react/plugins";

import { DefaultSourceIcon } from "../components/source-favicon";
import { LocalMcpInstallCard } from "../components/local-mcp-install-card";
import { SourcePluginsResetState } from "../components/source-plugins-reset-state";
import {
  getFrontendPlugin,
  getFrontendPluginRoute,
  getSourceFrontendTypeEntry,
  getSourceFrontendTypeEntryByKey,
  registeredSourceFrontendTypes,
} from "./index";
import {
  buildSourcePresetSearch,
  resolveQuickSourceInput,
  sourcePresets,
} from "./source-presets";

const FrontendPluginUnavailableState = () => (
  <SourcePluginsResetState
    title="Plugins unavailable"
    message="No plugins are available in this build."
  />
);

const SourcePluginUnavailableState = () => (
  <SourcePluginsResetState
    title="No source types available"
    message="No source types are available in this build."
  />
);

const SourcePluginPicker = (props: {
  activeKey: string | null;
}) => {
  if (registeredSourceFrontendTypes.length === 0) {
    return null;
  }

  return (
    <div className="mb-8 flex flex-wrap gap-2">
      {registeredSourceFrontendTypes.map((definition) => (
        <Link
          key={definition.key}
          to={createSourcePluginPaths(definition.key).add}
          className={
            props.activeKey === definition.key
              ? "rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-foreground"
              : "rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          {definition.displayName}
        </Link>
      ))}
    </div>
  );
};

const SourcePluginRouteMismatchState = (props: {
  requestedDisplayName: string;
  actualDisplayName: string;
}) => (
  <SourcePluginsResetState
    title="Wrong source type"
    message={`This source uses ${props.actualDisplayName}, but you navigated to ${props.requestedDisplayName}. Open it from the sidebar instead.`}
  />
);

const SourceQuickEntry = () => {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const resolved = resolveQuickSourceInput(value);
    if (resolved === null) {
      setError(
        "Could not recognize that input. Try a GraphQL endpoint, MCP URL, Google Discovery URL, OpenAPI spec URL, or a local MCP command.",
      );
      return;
    }

    setError(null);
    void navigate({
      to: createSourcePluginPaths(resolved.pluginKey).add,
      search: resolved.search,
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
        Quick add
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Paste a URL or command and we'll detect the right plugin automatically.
      </p>

      <form onSubmit={handleSubmit} className="mt-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://api.github.com/graphql or npx -y chrome-devtools-mcp@latest"
            className="h-10 flex-1 rounded-lg border border-input bg-background px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-ring focus:ring-1 focus:ring-ring/25"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Add source
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}
      </form>
    </div>
  );
};

export function ExecutorPluginRoutePage(input: {
  pluginKey: string;
  routeKey: FrontendPluginRouteDefinition["key"];
  params: FrontendPluginRouteParams;
  search: FrontendPluginRouteSearch;
  navigation: ExecutorPluginNavigation;
}) {
  const plugin = getFrontendPlugin(input.pluginKey);
  if (plugin === null) {
    return <FrontendPluginUnavailableState />;
  }

  const routeEntry = getFrontendPluginRoute(input.pluginKey, input.routeKey);
  if (routeEntry === null) {
    return (
      <SourcePluginsResetState
        title="Route unavailable"
        message={`The route "${input.routeKey}" is not available for this plugin.`}
      />
    );
  }

  const PluginPage = routeEntry.route.component;

  return (
    <ExecutorPluginRouteProvider
      value={{
        plugin,
        route: routeEntry.route,
        params: input.params,
        search: input.search,
        navigation: input.navigation,
      }}
    >
      <div className="h-full min-h-0">
        <PluginPage />
      </div>
    </ExecutorPluginRouteProvider>
  );
}

export function SourcePluginsIndexPage() {
  if (registeredSourceFrontendTypes.length === 0) {
    return <SourcePluginUnavailableState />;
  }

  const hasMcpPlugin = registeredSourceFrontendTypes.some(
    (definition) => definition.key === "mcp",
  );

  const presetsByPlugin = registeredSourceFrontendTypes
    .map((definition) => ({
      definition,
      presets: sourcePresets.filter((preset) => preset.pluginKey === definition.key),
    }))
    .filter((entry) => entry.presets.length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-14">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl tracking-tight text-foreground lg:text-4xl">
            Add source
          </h1>
          <p className="mt-1.5 text-[14px] text-muted-foreground">
            Connect a new tool provider to this workspace.
          </p>
        </div>

        <SourceQuickEntry />

        {hasMcpPlugin && (
          <LocalMcpInstallCard
            className="mt-8"
            title="Install this executor as MCP"
            description="Prefer a one-command setup? Install this local executor server into your MCP client, or add an external MCP source below."
          />
        )}

        {/* Presets */}
        {presetsByPlugin.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold text-foreground">Popular sources</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              One-click presets for common APIs and tools.
            </p>

            <div className="mt-5 space-y-8">
              {presetsByPlugin.map(({ definition, presets }) => {
                const paths = createSourcePluginPaths(definition.key);

                return (
                  <section key={definition.key}>
                    <h3 className="mb-3 text-sm font-semibold text-foreground">
                      {definition.displayName}
                    </h3>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {presets.map((preset) => (
                        <Link
                          key={preset.id}
                          to={paths.add}
                          search={buildSourcePresetSearch(preset)}
                          className="rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/25 hover:bg-card/90"
                        >
                          <div className="mb-2 flex items-center gap-2.5">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <DefaultSourceIcon kind={preset.kind} className="size-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-foreground">
                                {preset.name}
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {preset.kind}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs leading-5 text-muted-foreground">
                            {preset.summary}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {/* Browse by plugin type */}
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-foreground">By type</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Start from scratch with a specific plugin.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {registeredSourceFrontendTypes.map((definition) => {
              const paths = createSourcePluginPaths(definition.key);

              return (
                <Link
                  key={definition.key}
                  to={paths.add}
                  className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/25 hover:bg-card/90"
                >
                  <div className="flex h-full flex-col">
                    <div className="text-sm font-semibold text-foreground">
                      {definition.displayName}
                    </div>
                    <div className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">
                      {definition.description
                        ?? "Configure a new source from scratch."}
                    </div>
                    <div className="mt-4 text-xs font-medium text-primary">
                      Get started &rarr;
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SourcePluginAddPage(props: {
  definitionKey: string;
  search?: SourcePluginRouteSearch;
  navigation: SourcePluginNavigation;
}) {
  const entry = getSourceFrontendTypeEntryByKey(props.definitionKey);
  if (entry === null) {
    return <SourcePluginUnavailableState />;
  }

  const AddPage = entry.definition.renderAddPage;
  const search = props.search ?? {};

  return (
    <SourcePluginRouteProvider
      value={{
        plugin: entry.plugin,
        definition: entry.definition,
        params: {},
        search,
        navigation: props.navigation,
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
          <div className="mb-8">
            <h1 className="font-display text-3xl tracking-tight text-foreground lg:text-4xl">
              {entry.definition.displayName}
            </h1>
            {entry.definition.description && (
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {entry.definition.description}
              </p>
            )}
          </div>

          <SourcePluginPicker activeKey={entry.definition.key} />
          <AddPage key={JSON.stringify(search)} />
        </div>
      </div>
    </SourcePluginRouteProvider>
  );
}

export function SourcePluginEditPage(input: {
  definitionKey: string;
  sourceId: string;
  params?: SourcePluginRouteParams;
  search?: SourcePluginRouteSearch;
  navigation: SourcePluginNavigation;
}) {
  const requestedEntry = getSourceFrontendTypeEntryByKey(input.definitionKey);
  const source = useSource(input.sourceId);

  if (requestedEntry === null) {
    return <SourcePluginUnavailableState />;
  }

  return (
    <LoadableBlock loadable={source} loading="Loading source...">
      {(loadedSource) => {
        const entry = getSourceFrontendTypeEntry(loadedSource.kind);
        if (entry === null) {
          return (
            <SourcePluginsResetState
              title="Source type unavailable"
              message={`No plugin is available for source type "${loadedSource.kind}".`}
            />
          );
        }

        if (entry.definition.key !== requestedEntry.definition.key) {
          return (
            <SourcePluginRouteMismatchState
              requestedDisplayName={requestedEntry.definition.displayName}
              actualDisplayName={entry.definition.displayName}
            />
          );
        }

        if (entry.definition.renderEditPage === undefined) {
          return (
            <SourcePluginsResetState
              title="Editing unavailable"
              message={`No plugin is available for source type "${loadedSource.kind}".`}
            />
          );
        }

        const EditPage = entry.definition.renderEditPage;

        return (
          <SourcePluginRouteProvider
            value={{
              plugin: entry.plugin,
              definition: entry.definition,
              params: input.params ?? {
                sourceId: input.sourceId,
              },
              search: input.search ?? {},
              navigation: input.navigation,
            }}
          >
            <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
              <EditPage source={loadedSource} />
            </div>
          </SourcePluginRouteProvider>
        );
      }}
    </LoadableBlock>
  );
}

export function SourcePluginDetailPage(input: {
  definitionKey: string;
  sourceId: string;
  params?: SourcePluginRouteParams;
  search: SourcePluginRouteSearch;
  navigation: SourcePluginNavigation;
}) {
  const requestedEntry = getSourceFrontendTypeEntryByKey(input.definitionKey);
  const source = useSource(input.sourceId);

  if (requestedEntry === null) {
    return <SourcePluginUnavailableState />;
  }

  return (
    <LoadableBlock loadable={source} loading="Loading source...">
      {(loadedSource) => {
        const entry = getSourceFrontendTypeEntry(loadedSource.kind);
        if (entry === null) {
          return (
            <SourcePluginsResetState
              title="Source type unavailable"
              message={`No plugin is available for source type "${loadedSource.kind}".`}
            />
          );
        }

        if (entry.definition.key !== requestedEntry.definition.key) {
          return (
            <SourcePluginRouteMismatchState
              requestedDisplayName={requestedEntry.definition.displayName}
              actualDisplayName={entry.definition.displayName}
            />
          );
        }

        if (entry.definition.renderDetailPage === undefined) {
          return (
            <SourcePluginsResetState
              title="Details unavailable"
              message={`No plugin is available for source type "${loadedSource.kind}".`}
            />
          );
        }

        const DetailPage = entry.definition.renderDetailPage;

        return (
          <SourcePluginRouteProvider
            value={{
              plugin: entry.plugin,
              definition: entry.definition,
              params: input.params ?? {
                sourceId: input.sourceId,
              },
              search: input.search,
              navigation: input.navigation,
            }}
          >
            <div className="h-full min-h-0">
              <DetailPage source={loadedSource} />
            </div>
          </SourcePluginRouteProvider>
        );
      }}
    </LoadableBlock>
  );
}

export function SourcePluginDetailChildPage(input: {
  definitionKey: string;
  routeKey: FrontendSourceDetailRouteDefinition["key"];
  sourceId: string;
  params: SourcePluginRouteParams;
  search: SourcePluginRouteSearch;
  navigation: SourcePluginNavigation;
}) {
  const requestedEntry = getSourceFrontendTypeEntryByKey(input.definitionKey);
  const source = useSource(input.sourceId);

  if (requestedEntry === null) {
    return <SourcePluginUnavailableState />;
  }

  return (
    <LoadableBlock loadable={source} loading="Loading source...">
      {(loadedSource) => {
        const entry = getSourceFrontendTypeEntry(loadedSource.kind);
        if (entry === null) {
          return (
            <SourcePluginsResetState
              title="Source type unavailable"
              message={`No plugin is available for source type "${loadedSource.kind}".`}
            />
          );
        }

        if (entry.definition.key !== requestedEntry.definition.key) {
          return (
            <SourcePluginRouteMismatchState
              requestedDisplayName={requestedEntry.definition.displayName}
              actualDisplayName={entry.definition.displayName}
            />
          );
        }

        const detailRoute = entry.definition.detailRoutes?.find((route) =>
          route.key === input.routeKey
        );

        if (!detailRoute) {
          return (
            <SourcePluginsResetState
              title="Route unavailable"
              message={`The route "${input.routeKey}" is not available for this source type.`}
            />
          );
        }

        const DetailRoutePage = detailRoute.component;

        return (
          <SourcePluginRouteProvider
            value={{
              plugin: entry.plugin,
              definition: entry.definition,
              params: input.params,
              search: input.search,
              navigation: input.navigation,
            }}
          >
            <div className="h-full min-h-0">
              <DetailRoutePage source={loadedSource} />
            </div>
          </SourcePluginRouteProvider>
        );
      }}
    </LoadableBlock>
  );
}
