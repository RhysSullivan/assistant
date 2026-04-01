import { useState, Suspense, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Result, useAtomValue, useAtomRefresh, toolsAtom } from "@executor/react";
import type { SourcePlugin } from "@executor/react";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";

// ---------------------------------------------------------------------------
// Registered source plugins
// ---------------------------------------------------------------------------

const sourcePlugins: SourcePlugin[] = [openApiSourcePlugin];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SourcesPage() {
  const [adding, setAdding] = useState<string | null>(null);
  const tools = useAtomValue(toolsAtom());
  const refreshTools = useAtomRefresh(toolsAtom());

  const sources = useMemo(() => {
    if (tools._tag !== "Success") return [];
    const namespaces = new Map<string, number>();
    for (const tool of tools.value) {
      if (!tool.tags.includes("openapi")) continue;
      // Namespace is the last tag (after op tags and "openapi")
      const ns = tool.tags[tool.tags.length - 1];
      if (ns && ns !== "openapi") {
        namespaces.set(ns, (namespaces.get(ns) ?? 0) + 1);
      }
    }
    return [...namespaces.entries()].map(([namespace, toolCount]) => ({
      namespace,
      toolCount,
    }));
  }, [tools]);

  const plugin = adding
    ? sourcePlugins.find((p) => p.key === adding)
    : undefined;

  if (plugin) {
    const AddComponent = plugin.add;
    return (
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AddComponent
          onComplete={() => {
            setAdding(null);
            refreshTools();
          }}
          onCancel={() => setAdding(null)}
        />
      </Suspense>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Sources</h1>
        <div className="flex gap-2">
          {sourcePlugins.map((p) => (
            <button
              key={p.key}
              onClick={() => setAdding(p.key)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Add {p.label}
            </button>
          ))}
        </div>
      </div>

      {Result.match(tools, {
        onInitial: () => (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ),
        onFailure: () => (
          <p className="mt-4 text-sm text-destructive">Failed to load sources</p>
        ),
        onSuccess: () =>
          sources.length === 0 ? (
            <div className="mt-8 flex flex-col items-center justify-center text-center">
              <div className="rounded-full bg-muted p-4">
                <svg viewBox="0 0 24 24" fill="none" className="size-8 text-muted-foreground/50">
                  <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">No sources configured</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add an API source to start discovering tools.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {sources.map((s) => (
                <Link
                  key={s.namespace}
                  to="/sources/$namespace"
                  params={{ namespace: s.namespace }}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50 hover:border-primary/25"
                >
                  <div>
                    <p className="text-sm font-medium text-card-foreground">{s.namespace}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.toolCount} tool{s.toolCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                    openapi
                  </span>
                </Link>
              ))}
            </div>
          ),
      })}
    </div>
  );
}
