import { useSource } from "@executor/react";
import { LoadableBlock } from "../components/loadable";
import { SourcePluginsResetState } from "../components/source-plugins-reset-state";
import {
  getDefaultSourceFrontendType,
  getSourceFrontendType,
} from "./index";

export type SourcePluginRouteSearch = {
  tab: "model" | "discover";
  tool?: string;
  query?: string;
};

export function SourcePluginAddPage() {
  const definition = getDefaultSourceFrontendType();
  if (definition === null) {
    return (
      <SourcePluginsResetState
        title="Add Source is intentionally blank"
        message="No source plugins are registered in this build."
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
      <div className="mb-8">
        <div className="inline-flex rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Source Plugin
        </div>
        <h1 className="mt-5 font-display text-3xl tracking-tight text-foreground lg:text-4xl">
          {definition.displayName}
        </h1>
      </div>
      {definition.renderAddPage()}
    </div>
  );
}

export function SourcePluginCreatePage() {
  const definition = getDefaultSourceFrontendType();
  if (definition === null) {
    return (
      <SourcePluginsResetState
        title="New source creation is disabled"
        message="No source plugins are registered in this build."
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
      {definition.renderAddPage()}
    </div>
  );
}

export function SourcePluginEditPage(input: {
  sourceId: string;
}) {
  const source = useSource(input.sourceId);

  return (
    <LoadableBlock loadable={source} loading="Loading source...">
      {(loadedSource) => {
        const definition = getSourceFrontendType(loadedSource.kind);
        if (definition?.renderEditPage === undefined) {
          return (
            <SourcePluginsResetState
              title="Source editing is disabled"
              message={`No frontend source plugin is registered for kind "${loadedSource.kind}".`}
            />
          );
        }

        return (
          <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
            {definition.renderEditPage({ source: loadedSource })}
          </div>
        );
      }}
    </LoadableBlock>
  );
}

export function SourcePluginDetailPage(input: {
  sourceId: string;
  search: SourcePluginRouteSearch;
  navigate: unknown;
}) {
  const source = useSource(input.sourceId);

  return (
    <LoadableBlock loadable={source} loading="Loading source...">
      {(loadedSource) => {
        const definition = getSourceFrontendType(loadedSource.kind);
        if (definition?.renderDetailPage === undefined) {
          return (
            <SourcePluginsResetState
              title="Source detail is disabled"
              message={`No frontend source plugin is registered for kind "${loadedSource.kind}".`}
            />
          );
        }

        return (
          <div className="h-full min-h-0">
            {definition.renderDetailPage({
              source: loadedSource,
              route: {
                search: input.search,
                navigate: input.navigate,
              },
            })}
          </div>
        );
      }}
    </LoadableBlock>
  );
}
