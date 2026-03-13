import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import { Badge, MethodBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { IconArrowLeft, IconSpinner } from "../components/icons";
import { cn } from "../lib/utils";

type BrowserSourceNetworkLog = {
  id: string;
  method: string;
  url: string;
  resourceType: string | null;
  initiator: string | null;
  status: number | null;
  mimeType: string | null;
  startedAt: number;
  durationMs: number | null;
  encodedDataLength: number | null;
  failedText: string | null;
};

type BrowserSourceSessionStatus = {
  active: boolean;
  url: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  pageTitle: string | null;
  pageUrl: string | null;
  launchMode: "headful" | "headless";
  note: string | null;
  logs: ReadonlyArray<BrowserSourceNetworkLog>;
};

type ProposedOperation = {
  id: string;
  name: string;
  route: string;
  method: string;
  confidence: number;
  auth: "session" | "bearer" | "csrf";
  params: ReadonlyArray<string>;
  reason: string;
};

const initialStatus: BrowserSourceSessionStatus = {
  active: false,
  url: null,
  startedAt: null,
  stoppedAt: null,
  pageTitle: null,
  pageUrl: null,
  launchMode: "headless",
  note: null,
  logs: [],
};

const titleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const pascalCase = (value: string) =>
  titleCase(value)
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join("");

const routeLabel = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
};

const operationNameFromUrl = (url: string, method: string, index: number) => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean).slice(-2);
    const suffix = segments.length > 0 ? segments.join("_") : `flow_${index + 1}`;
    return `${method.toLowerCase()}_${suffix}`.replace(/[^a-z0-9_]+/gi, "_");
  } catch {
    return `${method.toLowerCase()}_flow_${index + 1}`;
  }
};

const deriveOperations = (logs: ReadonlyArray<BrowserSourceNetworkLog>): ReadonlyArray<ProposedOperation> =>
  logs
    .filter((log) =>
      log.url.startsWith("http")
      && (log.resourceType === "Fetch" || log.resourceType === "XHR" || log.resourceType === "Document")
    )
    .slice(0, 5)
    .map((log, index) => ({
      id: log.id,
      name: operationNameFromUrl(log.url, log.method, index),
      route: routeLabel(log.url),
      method: log.method,
      confidence: Math.max(0.55, 0.9 - index * 0.08),
      auth: index === 0 ? "session" : index === 1 ? "csrf" : "bearer",
      params: index === 0 ? ["cursor", "workspaceId"] : index === 1 ? ["id", "input"] : ["page", "limit", "filters"],
      reason: index === 0
        ? "Repeated document/bootstrap flow with stable session envelope"
        : index === 1
          ? "Mutation-like request shape plus likely CSRF coupling"
          : "Header and response shape look stable enough for direct replay",
    }));

const sdkPreview = (status: BrowserSourceSessionStatus, operations: ReadonlyArray<ProposedOperation>) => {
  const namespace = "browser.session";
  const sourceName = pascalCase(status.pageTitle ?? "Browser Session Source") || "BrowserSessionSource";
  const signatures = operations.map((operation) =>
    `  ${operation.name}(params: ${pascalCase(operation.name)}Params): Promise<${pascalCase(operation.name)}Response>;\n`,
  ).join("");
  const impls = operations.map((operation) =>
    `  async ${operation.name}(params: ${pascalCase(operation.name)}Params) {\n    return this.transport.request("${operation.method}", "${operation.route}", params)\n  }\n`,
  ).join("\n");

  return `// Draft SDK synthesized from captured browser traffic
export namespace ${namespace} {
  export interface SessionTransport {
    request(method: string, route: string, body?: unknown): Promise<unknown>;
  }

  export interface ${sourceName}Sdk {
${signatures}}

  export const createSdk = (transport: SessionTransport): ${sourceName}Sdk => ({
${impls}
  })
}`;
};

const statusTone = (status: number | null) => {
  if (status === null) return "text-slate-600 bg-slate-500/10 border-slate-500/20";
  if (status >= 500) return "text-rose-600 bg-rose-500/10 border-rose-500/20";
  if (status >= 400) return "text-amber-700 bg-amber-500/10 border-amber-500/20";
  return "text-emerald-700 bg-emerald-500/10 border-emerald-500/20";
};

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function BrowserSourcePage() {
  const [url, setUrl] = useState("https://example.com");
  const [status, setStatus] = useState<BrowserSourceSessionStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [sdkCopied, setSdkCopied] = useState(false);

  const operations = useMemo(() => deriveOperations(status.logs), [status.logs]);
  const preview = useMemo(() => sdkPreview(status, operations), [status, operations]);

  const loadStatus = async () => {
    const response = await fetch("/v1/browser-source/session");
    const data = await response.json() as BrowserSourceSessionStatus | { error: string };
    if (!response.ok) {
      throw new Error("error" in data ? data.error : "Failed loading browser source status.");
    }
    setStatus(data as BrowserSourceSessionStatus);
  };

  useEffect(() => {
    void loadStatus().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  useEffect(() => {
    if (!status.active) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadStatus().catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    }, 1250);
    return () => window.clearInterval(interval);
  }, [status.active]);

  useEffect(() => {
    if (!sdkCopied) {
      return;
    }
    const timeout = window.setTimeout(() => setSdkCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [sdkCopied]);

  const handleStart = async () => {
    setBusy("start");
    setError(null);
    try {
      const response = await fetch("/v1/browser-source/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ url }),
      });
      const data = await response.json() as BrowserSourceSessionStatus | { error: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error : "Failed to start browser capture.");
      }
      setStatus(data as BrowserSourceSessionStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handleStop = async () => {
    setBusy("stop");
    setError(null);
    try {
      const response = await fetch("/v1/browser-source/session", {
        method: "DELETE",
      });
      const data = await response.json() as BrowserSourceSessionStatus | { error: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error : "Failed to stop browser capture.");
      }
      setStatus(data as BrowserSourceSessionStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setSdkCopied(true);
    } catch {}
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.16),transparent_25%),radial-gradient(circle_at_top_right,rgba(180,83,9,0.12),transparent_24%),linear-gradient(180deg,transparent,rgba(15,23,42,0.03))]">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-12">
        <Link
          to="/sources/add"
          className="mb-6 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-3.5" />
          Back to add source
        </Link>

        <section className="overflow-hidden rounded-[30px] border border-border/70 bg-card/80 shadow-[0_25px_80px_-40px_rgba(15,23,42,0.65)] backdrop-blur">
          <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="relative border-b border-border/70 p-6 lg:border-b-0 lg:border-r">
              <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(13,148,136,0.08),transparent_38%,rgba(180,83,9,0.08))]" />
              <div className="relative space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    Prototype
                  </Badge>
                  <Badge variant="outline">browser source</Badge>
                  <Badge variant="outline" className="border-border/80 bg-background/75">
                    Dedicated add flow
                  </Badge>
                </div>

                <div className="space-y-3">
                  <h1 className="font-display text-4xl tracking-[-0.05em] text-foreground sm:text-[3.2rem]">
                    Attach to a browser, interact manually, then promote the traffic into a source.
                  </h1>
                  <p className="max-w-2xl text-[15px] leading-7 text-muted-foreground">
                    Enter a URL, launch a real Chrome window, click around as the logged-in user,
                    and stop capture when you have enough network evidence to infer stable operations.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://app.example.com"
                    className="h-11 rounded-xl border border-input bg-background/90 px-4 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                  <Button onClick={() => void handleStart()} disabled={busy !== null}>
                    {busy === "start" ? <IconSpinner className="size-3.5" /> : null}
                    Start capture
                  </Button>
                  <Button variant="outline" onClick={() => void handleStop()} disabled={busy !== null || !status.active}>
                    {busy === "stop" ? <IconSpinner className="size-3.5" /> : null}
                    Stop capture
                  </Button>
                </div>

                {error && (
                  <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                  </div>
                )}

                {status.note && !error && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    {status.note}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    label="Active state"
                    value={status.active ? "Live" : "Idle"}
                    detail={status.active
                      ? status.launchMode === "headful"
                        ? "Browser session open, polling request logs."
                        : "Headless browser session running on the server."
                      : "No active capture session."}
                  />
                  <MetricCard label="Captured requests" value={String(status.logs.length)} detail="Most recent request events from the attached browser window." />
                  <MetricCard label="Draft operations" value={String(operations.length)} detail="High-confidence candidates inferred from the captured traffic." />
                  <MetricCard label="Current page" value={status.pageTitle ?? "Not loaded"} detail={status.pageUrl ?? "No page attached yet."} />
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-4 bg-[linear-gradient(180deg,rgba(250,250,249,0.15),transparent)] p-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Session
                  </p>
                  <SessionLamp active={status.active} />
                </div>
                <div className="space-y-2 rounded-2xl border border-border/70 bg-background/75 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Requested URL</span>
                    <span className="max-w-[14rem] truncate font-medium">{status.url ?? "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Launch mode</span>
                    <span className="font-medium">{status.launchMode}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Started</span>
                    <span className="font-medium">{status.startedAt ? new Date(status.startedAt).toLocaleTimeString() : "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Stopped</span>
                    <span className="font-medium">{status.stoppedAt ? new Date(status.stoppedAt).toLocaleTimeString() : "still running"}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Workflow
                </p>
                <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                  <li>1. Enter the app URL you want to source from.</li>
                  <li>2. Press `Start capture` to open Chrome and begin collecting network events.</li>
                  <li>3. Interact in the browser window, then return here and press `Stop capture`.</li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="overflow-hidden rounded-[24px] border border-border/70 bg-card/75 backdrop-blur">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Network Log
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground">
                  Live capture feed
                </h2>
              </div>
              <Badge variant="outline" className="border-border/80 bg-background/70">
                {status.active ? "Polling" : "Snapshot"}
              </Badge>
            </div>

            {status.logs.length === 0 ? (
              <div className="px-5 py-12 text-sm text-muted-foreground">
                No network activity yet. Start a capture session, interact in the browser, and the request feed will appear here.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {status.logs.map((log) => (
                  <div key={log.id} className="grid gap-3 px-5 py-4 md:grid-cols-[auto_1fr_auto] md:items-center">
                    <div className="flex items-center gap-2">
                      <MethodBadge method={log.method} />
                      <span className={cn("rounded-full border px-2 py-1 text-[11px] font-medium", statusTone(log.status))}>
                        {log.status ?? "pending"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-medium text-foreground">{routeLabel(log.url)}</p>
                        {log.resourceType && (
                          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {log.resourceType}
                          </span>
                        )}
                        {log.initiator && (
                          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
                            {log.initiator}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {log.failedText
                          ? `Failed: ${log.failedText}`
                          : `${log.mimeType ?? "unknown mime"} · ${formatBytes(log.encodedDataLength)}`}
                      </p>
                    </div>
                    <div className="flex items-end justify-between gap-4 md:block md:text-right">
                      <p className="text-xs text-muted-foreground">
                        {log.durationMs === null ? "pending" : `${log.durationMs}ms`}
                      </p>
                      <p className="mt-1 text-xs font-medium text-foreground">
                        {new Date(log.startedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-[24px] border border-border/70 bg-card/75 backdrop-blur">
            <div className="border-b border-border/70 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Inferred Operations
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground">
                Candidate methods promoted from the capture
              </h2>
            </div>

            {operations.length === 0 ? (
              <div className="px-5 py-12 text-sm text-muted-foreground">
                Capture a few document, XHR, or fetch requests and the draft operation model will appear here.
              </div>
            ) : (
              <div className="grid gap-3 p-4">
                {operations.map((operation) => (
                  <article
                    key={operation.id}
                    className="rounded-[20px] border border-border/70 bg-background/70 p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.7)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <MethodBadge method={operation.method} />
                      <p className="text-sm font-semibold text-foreground">{operation.name}</p>
                      <Badge variant="outline" className="ml-auto border-border/80 bg-background/80 text-[11px]">
                        {operation.auth}
                      </Badge>
                    </div>
                    <p className="mt-2 font-mono text-[12px] text-muted-foreground">{operation.route}</p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{operation.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {operation.params.map((param) => (
                        <span
                          key={param}
                          className="rounded-full border border-border/70 bg-muted/70 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
                        >
                          {param}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="mt-5 overflow-hidden rounded-[24px] border border-border/70 bg-slate-950 text-slate-100 shadow-[0_25px_60px_-36px_rgba(2,6,23,0.92)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Generated SDK Preview
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-white">
                Draft client from the current capture
              </h2>
            </div>
            <Button
              variant="outline"
              className="border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white"
              onClick={() => void handleCopy()}
            >
              {sdkCopied ? "Copied" : "Copy draft"}
            </Button>
          </div>

          <pre className="overflow-x-auto p-5 text-[12px] leading-6 text-slate-200">
            <code>{preview}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}

function MetricCard(props: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[18px] border border-border/70 bg-background/75 p-4 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.85)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.04em] text-foreground">
        {props.value}
      </p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {props.detail}
      </p>
    </div>
  );
}

function SessionLamp(props: { active: boolean }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/70 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          props.active
            ? "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.15)]"
            : "bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.14)]",
        )}
      />
      {props.active ? "capturing" : "idle"}
    </div>
  );
}
