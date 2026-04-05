import { useReducer, useCallback, useMemo, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { Result, useAtomValue, useAtomRefresh, useAtomSet, sourcesAtom, detectSource } from "@executor/react";
import { useScope } from "../lib/use-scope";
import type { SourcePlugin, SourcePreset } from "@executor/react";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";
import { mcpSourcePlugin } from "@executor/plugin-mcp/react";
import { googleDiscoverySourcePlugin } from "@executor/plugin-google-discovery/react";
import { graphqlSourcePlugin } from "@executor/plugin-graphql/react";
import { McpInstallCard } from "../components/mcp-install-card";

// ---------------------------------------------------------------------------
// Registered source plugins
// ---------------------------------------------------------------------------

const sourcePlugins: SourcePlugin[] = [
  openApiSourcePlugin,
  mcpSourcePlugin,
  googleDiscoverySourcePlugin,
  graphqlSourcePlugin,
];

const KIND_TO_PLUGIN_KEY: Record<string, string> = {
  openapi: "openapi",
  mcp: "mcp",
  graphql: "graphql",
  googleDiscovery: "googleDiscovery",
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type State = {
  step: "list" | "detecting" | "adding";
  url: string;
  error: string | null;
  pluginKey: string | null;
  initialUrl: string | undefined;
};

type Action =
  | { type: "set-url"; url: string }
  | { type: "detect-start" }
  | { type: "detect-ok"; pluginKey: string; url: string }
  | { type: "detect-no-match" }
  | { type: "detect-unknown-kind"; kind: string }
  | { type: "detect-fail" }
  | { type: "add-manual"; pluginKey: string }
  | { type: "add-preset"; pluginKey: string; url: string }
  | { type: "back" };

const init: State = { step: "list", url: "", error: null, pluginKey: null, initialUrl: undefined };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set-url":
      return { ...state, step: "list", url: action.url, error: null };
    case "detect-start":
      return { ...state, step: "detecting", error: null };
    case "detect-ok":
      return { ...state, step: "adding", pluginKey: action.pluginKey, initialUrl: action.url };
    case "detect-no-match":
      return { ...state, step: "list", error: "Could not detect a source type from this URL. Try adding manually." };
    case "detect-unknown-kind":
      return { ...state, step: "list", error: `Detected source type "${action.kind}" but no plugin is available for it.` };
    case "detect-fail":
      return { ...state, step: "list", error: "Detection failed. Try adding a source manually." };
    case "add-manual":
      return { ...state, step: "adding", pluginKey: action.pluginKey, initialUrl: undefined };
    case "add-preset":
      return { ...state, step: "adding", pluginKey: action.pluginKey, initialUrl: action.url };
    case "back":
      return init;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SourcesPage() {
  const [state, dispatch] = useReducer(reducer, init);
  const scopeId = useScope();
  const sources = useAtomValue(sourcesAtom(scopeId));
  const refreshSources = useAtomRefresh(sourcesAtom(scopeId));
  const doDetect = useAtomSet(detectSource, { mode: "promise" });

  const handleDetect = useCallback(async () => {
    const trimmed = state.url.trim();
    if (!trimmed) return;
    dispatch({ type: "detect-start" });
    try {
      const results = await doDetect({
        path: { scopeId },
        payload: { url: trimmed },
      });
      if (results.length === 0) {
        dispatch({ type: "detect-no-match" });
        return;
      }
      const pluginKey = KIND_TO_PLUGIN_KEY[results[0].kind];
      if (pluginKey) {
        dispatch({ type: "detect-ok", pluginKey, url: trimmed });
      } else {
        dispatch({ type: "detect-unknown-kind", kind: results[0].kind });
      }
    } catch {
      dispatch({ type: "detect-fail" });
    }
  }, [state.url, doDetect]);

  // ---------------------------------------------------------------------------
  // Adding view
  // ---------------------------------------------------------------------------

  if (state.step === "adding" && state.pluginKey) {
    const plugin = sourcePlugins.find((p) => p.key === state.pluginKey);
    if (!plugin) return null;
    const AddComponent = plugin.add;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <AddComponent
              initialUrl={state.initialUrl}
              onComplete={() => {
                dispatch({ type: "back" });
                refreshSources();
              }}
              onCancel={() => dispatch({ type: "back" })}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // List view
  // ---------------------------------------------------------------------------

  const isDetecting = state.step === "detecting";
  const error = state.step === "list" ? state.error : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="font-display text-3xl tracking-tight text-foreground lg:text-4xl">
                Sources
              </h1>
              <p className="mt-1.5 text-[14px] text-muted-foreground">
                Tool providers available in this workspace.
              </p>
            </div>
          </div>

          {/* URL detection input */}
          <div className="mt-5">
            <div className="flex gap-2">
              <input
                type="url"
                value={state.url}
                onChange={(e) => dispatch({ type: "set-url", url: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") handleDetect(); }}
                placeholder="Paste a URL to auto-detect source type..."
                disabled={isDetecting}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
              <button
                onClick={handleDetect}
                disabled={isDetecting || !state.url.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
              >
                {isDetecting ? "Detecting..." : "Detect"}
              </button>
            </div>
            {error && (
              <p className="mt-2 text-sm text-destructive">{error}</p>
            )}
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Or add manually:</span>
              {sourcePlugins.map((p) => (
                <button
                  key={p.key}
                  onClick={() => dispatch({ type: "add-manual", pluginKey: p.key })}
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <McpInstallCard className="mb-8 rounded-2xl border border-border bg-card/80 p-5" />

        <PresetGrid plugins={sourcePlugins} dispatch={dispatch} />

        {Result.match(sources, {
          onInitial: () => (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ),
          onFailure: () => (
            <p className="text-sm text-destructive">Failed to load sources</p>
          ),
          onSuccess: ({ value }) => {
            const builtInSources = value.filter((source) => source.runtime);
            const connectedSources = value.filter((source) => !source.runtime);

            return value.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-4">
                  <svg viewBox="0 0 24 24" fill="none" className="size-5">
                    <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-[14px] font-medium text-foreground/70 mb-1">
                  No sources yet
                </p>
                <p className="text-[13px] text-muted-foreground/60 mb-5">
                  Add a source to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {builtInSources.length > 0 && (
                  <section className="space-y-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">
                        Built-in
                      </h2>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        Runtime sources exposed by the loaded executor plugins.
                      </p>
                    </div>
                    <SourceGrid sources={builtInSources} />
                  </section>
                )}

                {connectedSources.length > 0 && (
                  <section className="space-y-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">
                        Connected
                      </h2>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        User-configured sources available in this workspace.
                      </p>
                    </div>
                    <SourceGrid sources={connectedSources} />
                  </section>
                )}
              </div>
            );
          },
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset grid
// ---------------------------------------------------------------------------

function PresetGrid(props: {
  plugins: readonly SourcePlugin[];
  dispatch: React.Dispatch<Action>;
}) {
  const allPresets = useMemo(() => {
    const out: { preset: SourcePreset; pluginKey: string; pluginLabel: string }[] = [];
    for (const plugin of props.plugins) {
      for (const preset of plugin.presets ?? []) {
        out.push({ preset, pluginKey: plugin.key, pluginLabel: plugin.label });
      }
    }
    return out;
  }, [props.plugins]);

  if (allPresets.length === 0) return null;

  return (
    <section className="mb-8 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Presets</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          One-click setup for common APIs and services.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {allPresets.map(({ preset, pluginKey, pluginLabel }) => (
          <button
            key={`${pluginKey}-${preset.id}`}
            onClick={() => props.dispatch({ type: "add-preset", pluginKey, url: preset.url })}
            className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/25 hover:bg-card/90"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground overflow-hidden">
              {preset.icon ? (
                <img src={preset.icon} alt="" className="size-5 object-contain" loading="lazy" />
              ) : (
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{preset.name}</span>
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                  {pluginLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{preset.summary}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Source grid
// ---------------------------------------------------------------------------

function SourceGrid(props: {
  sources: readonly { id: string; name: string; kind: string; runtime?: boolean }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {props.sources.map((s) => (
        <Link
          key={s.id}
          to="/sources/$namespace"
          params={{ namespace: s.id }}
          className="flex h-full flex-col rounded-2xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/25 hover:bg-card/90"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <svg viewBox="0 0 16 16" className="size-4">
                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="truncate text-sm font-semibold text-foreground">
                  {s.name}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {s.runtime && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      built-in
                    </span>
                  )}
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                    {s.kind}
                  </span>
                </div>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {s.id}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
