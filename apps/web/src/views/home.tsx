import { Link } from "@tanstack/react-router";
import { useSources, type Source } from "@executor-v3/react";
import { LoadableBlock } from "../components/loadable";
import { LocalMcpInstallCard } from "../components/local-mcp-install-card";
import { SourceFavicon } from "../components/source-favicon";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { IconSources, IconPlus } from "../components/icons";

export function HomePage() {
  const sources = useSources();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
        {/* Header */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl tracking-tight text-foreground lg:text-4xl">
              Sources
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              Connected tool providers in this workspace.
            </p>
          </div>
          <Link to="/sources/add">
            <Button size="sm">
              <IconPlus className="size-3.5" />
              Add source
            </Button>
          </Link>
        </div>

        <LocalMcpInstallCard className="mb-8" />

        {/* Source list */}
        <LoadableBlock loadable={sources} loading="Loading sources...">
          {(items) =>
            items.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-4">
                  <IconSources className="size-5" />
                </div>
                <p className="text-[14px] font-medium text-foreground/70 mb-1">
                  No sources yet
                </p>
                <p className="text-[13px] text-muted-foreground/60 mb-5">
                  Add a source to get started.
                </p>
                <Link to="/sources/add">
                  <Button size="sm">
                    <IconPlus className="size-3.5" />
                    Add source
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((source) => (
                  <SourceCard key={source.id} source={source} />
                ))}
              </div>
            )
          }
        </LoadableBlock>
      </div>
    </div>
  );
}

function SourceCard({ source }: { source: Source }) {
  return (
    <Link
      to="/sources/$sourceId"
      params={{ sourceId: source.id }}
      search={{ tab: "model" }}
      className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)]"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
          <SourceFavicon endpoint={source.endpoint} kind={source.kind} className="size-4.5" />
        </div>
        <Badge variant={source.status === "connected" ? "default" : source.status === "error" ? "destructive" : "muted"} className="shrink-0">
          {source.status}
        </Badge>
      </div>
      <h3 className="text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors mb-0.5">
        {source.name}
      </h3>
      <div className="flex items-center gap-2 mt-auto pt-2">
        <Badge variant="outline" className="text-[9px]">{source.kind}</Badge>
      </div>
    </Link>
  );
}
