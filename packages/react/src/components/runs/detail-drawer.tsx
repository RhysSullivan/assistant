"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { Execution, ExecutionInteraction } from "@executor/sdk";

import { cn } from "../../lib/utils";
import { Button } from "../button";
import { CodeBlock } from "../code-block";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../sheet";
import { getExecution, type GetExecutionResponse } from "../../api/executions";
import { statusTone, statusLabel } from "./status";

// ---------------------------------------------------------------------------
// Detail drawer — v1.3 aesthetic, openstatus-triggered via URL state
// ---------------------------------------------------------------------------
//
// Differences from v1.3:
//   - Backed by TanStack Query's getExecution endpoint (not LoadableBlock).
//   - Built on our existing Sheet primitive (Radix dialog slide-in) widened
//     to sm:max-w-3xl.
//   - `CodeBlock` replaces v1.3's DocumentPanel — same visual role, Shiki
//     highlighting, copy-to-clipboard.
// Same elsewhere: tabbed Properties / Logs, 2-col status+duration cards,
// compact created/started row, per-line log coloring, Copy JSON button.

type DetailTab = "properties" | "logs";

const formatTimestamp = (value: number | null): string => {
  if (value === null) return "—";
  const d = new Date(value);
  const month = d.toLocaleString(undefined, { month: "short" });
  const day = d.getDate();
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${month} ${day}, ${h}:${m}:${s}`;
};

const formatDuration = (execution: Execution): string => {
  if (execution.startedAt === null || execution.completedAt === null) return "—";
  const ms = Math.max(0, execution.completedAt - execution.startedAt);
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
};

const prettyJson = (value: string | null): string | null => {
  if (value === null) return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

const parseLogs = (logsJson: string | null): string[] | null => {
  if (logsJson === null) return null;
  try {
    const parsed = JSON.parse(logsJson);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    return null;
  }
  return null;
};

// ---------------------------------------------------------------------------

export interface RunsDetailDrawerProps {
  readonly executionId?: string;
  readonly onOpenChange: (open: boolean) => void;
}

export function RunsDetailDrawer({ executionId, onOpenChange }: RunsDetailDrawerProps) {
  const open = Boolean(executionId);
  const query = useQuery({
    queryKey: ["execution", executionId],
    queryFn: () => getExecution(executionId!),
    enabled: open,
    staleTime: 10_000,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          "w-full gap-0 p-0 sm:max-w-3xl",
          "bg-popover text-popover-foreground",
          "border-l border-border/70",
        )}
      >
        <DrawerBody executionId={executionId} query={query} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  executionId,
  query,
  onClose,
}: {
  readonly executionId?: string;
  readonly query: ReturnType<typeof useQuery<GetExecutionResponse>>;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = React.useState<DetailTab>("properties");
  const [copied, setCopied] = React.useState(false);

  const envelope = query.data;

  const handleCopyJson = React.useCallback(() => {
    if (!envelope) return;
    const tryParse = (value: string | null): unknown => {
      if (value === null) return null;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };

    const cleaned = {
      ...envelope,
      execution: {
        ...envelope.execution,
        resultJson: tryParse(envelope.execution.resultJson),
        logsJson: tryParse(envelope.execution.logsJson),
      },
    };
    void navigator.clipboard.writeText(JSON.stringify(cleaned, null, 2)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [envelope]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Hidden titles for radix a11y */}
      <SheetHeader className="sr-only">
        <SheetTitle>Execution details</SheetTitle>
        <SheetDescription>{executionId ?? "No execution selected"}</SheetDescription>
      </SheetHeader>

      {/* Visible header — mono id + actions */}
      <div className="flex items-center justify-between border-border/60 border-b px-5 py-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm text-foreground">
            {executionId ?? "—"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyJson}
            disabled={!envelope}
            className="h-7 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" className="size-3.5">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-border/60 border-b px-5">
        <TabButton label="Properties" active={tab === "properties"} onClick={() => setTab("properties")} />
        <TabButton label="Logs" active={tab === "logs"} onClick={() => setTab("logs")} />
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {query.isLoading ? (
          <p className="font-mono text-xs text-muted-foreground">Loading execution…</p>
        ) : query.isError ? (
          <p className="font-mono text-xs text-[color:var(--color-error)]">
            Failed to load execution details.
          </p>
        ) : envelope ? (
          tab === "properties" ? (
            <PropertiesTab envelope={envelope} />
          ) : (
            <LogsTab logsJson={envelope.execution.logsJson} />
          )
        ) : (
          <p className="font-mono text-xs text-muted-foreground">Execution not found.</p>
        )}
      </div>
    </div>
  );
}

function TabButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "px-3 py-2 text-xs font-medium transition-colors",
        props.active
          ? "border-b-2 border-foreground text-foreground"
          : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {props.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Properties tab
// ---------------------------------------------------------------------------

function PropertiesTab({ envelope }: { envelope: GetExecutionResponse }) {
  const { execution, pendingInteraction } = envelope;
  const tone = statusTone(execution.status);
  const formattedResult = prettyJson(execution.resultJson);

  return (
    <div className="space-y-4">
      {/* 2-col status/duration cards */}
      <div className="grid grid-cols-2 gap-3">
        <MetaCard label="Status">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn("size-2 rounded-full", tone.dot, tone.pulse && "animate-pulse")}
            />
            <span className="text-sm">{statusLabel(execution.status)}</span>
          </span>
        </MetaCard>
        <MetaCard label="Duration">
          <span className="text-sm tabular-nums">{formatDuration(execution)}</span>
        </MetaCard>
      </div>

      {/* Compact timeline row */}
      <div className="grid grid-cols-2 gap-3 font-mono text-[11px] text-muted-foreground">
        <TimelineLine label="Created" value={formatTimestamp(execution.createdAt)} />
        <TimelineLine label="Started" value={formatTimestamp(execution.startedAt)} />
        <TimelineLine label="Completed" value={formatTimestamp(execution.completedAt)} />
        <TimelineLine label="Updated" value={formatTimestamp(execution.updatedAt)} />
      </div>

      <CodeBlock title="Code" code={execution.code} lang="ts" />

      {formattedResult ? (
        <CodeBlock title="Result" code={formattedResult} lang="json" />
      ) : (
        <EmptyPanel title="Result" message="No result recorded." />
      )}

      {execution.errorText ? (
        <div className="overflow-hidden rounded-lg border border-[color:var(--color-error)]/40 bg-[color:color-mix(in_srgb,var(--color-error)_7%,transparent)]">
          <div className="border-b border-[color:var(--color-error)]/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-error)]">
            Error
          </div>
          <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">
            {execution.errorText}
          </pre>
        </div>
      ) : null}

      {pendingInteraction ? <PendingInteractionBlock interaction={pendingInteraction} /> : null}
    </div>
  );
}

function MetaCard(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {props.label}
      </div>
      <div className="mt-1 text-foreground">{props.children}</div>
    </div>
  );
}

function TimelineLine(props: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground/60">{props.label} </span>
      <span className="tabular-nums">{props.value}</span>
    </div>
  );
}

function EmptyPanel(props: { title: string; message: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
      <div className="border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {props.title}
      </div>
      <div className="px-3 py-3 font-mono text-[11px] text-muted-foreground/60">
        {props.message}
      </div>
    </div>
  );
}

function PendingInteractionBlock({ interaction }: { interaction: ExecutionInteraction }) {
  const request = prettyJson(interaction.payloadJson);
  const response = prettyJson(interaction.responseJson);

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">Pending interaction</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {interaction.kind} — {interaction.purpose}
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {interaction.status}
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {request ? (
          <CodeBlock title="Request" code={request} lang="json" />
        ) : (
          <EmptyPanel title="Request" message="No request captured." />
        )}
        {response ? (
          <CodeBlock title="Response" code={response} lang="json" />
        ) : (
          <EmptyPanel title="Response" message="No response captured." />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logs tab
// ---------------------------------------------------------------------------

function LogsTab({ logsJson }: { logsJson: string | null }) {
  const lines = React.useMemo(() => parseLogs(logsJson), [logsJson]);

  if (!lines) {
    const formatted = prettyJson(logsJson);
    if (!formatted) {
      return (
        <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-12 text-center font-mono text-xs text-muted-foreground/60">
          No logs recorded.
        </div>
      );
    }
    return <CodeBlock title="Logs" code={formatted} lang="json" />;
  }

  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-12 text-center font-mono text-xs text-muted-foreground/60">
        No logs recorded.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
      <div className="border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        Logs
      </div>
      <div className="divide-y divide-border/30">
        {lines.map((line, index) => {
          const isError = /\[error\]/i.test(line);
          const isWarn = /\[warn\]/i.test(line);
          return (
            <div
              key={`${index}-${line.slice(0, 32)}`}
              className={cn(
                "px-3 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all",
                isError && "text-[color:var(--color-error)]",
                isWarn && "text-[color:var(--color-warning)]",
                !isError && !isWarn && "text-foreground/80",
              )}
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}
