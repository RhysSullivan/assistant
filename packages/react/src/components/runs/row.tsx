import * as React from "react";
import type { Execution, ExecutionStatus } from "@executor/sdk";

import { cn } from "../../lib/utils";
import { statusTone } from "./status";

// ---------------------------------------------------------------------------
// RunRow — v1.3 log-line aesthetic
// ---------------------------------------------------------------------------
//
// Single row of the /runs list. Every run renders as a dense, monospace
// key-value log line — muted labels, color-coded values, a single status
// dot, no cells in a grid. v1.3 used a plain <button>; we do the same so
// the entire row is one click target and keyboard-focusable.
//
// Layout (left to right):
//   [dot] [timestamp]  status: <colored>   duration_ms: <colored>   code: "…"

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

const formatDurationMs = (execution: Execution): string | null => {
  if (execution.startedAt === null || execution.completedAt === null) return null;
  const ms = Math.max(0, execution.completedAt - execution.startedAt);
  return ms.toLocaleString();
};

const truncateCode = (code: string, max: number): string =>
  code.trim().replace(/\s+/g, " ").slice(0, max);

const statusWord = (status: ExecutionStatus): string => status.replaceAll("_", " ");

export interface RunRowProps {
  readonly execution: Execution;
  readonly isSelected?: boolean;
  readonly onSelect?: () => void;
}

export function RunRow({ execution, isSelected, onSelect }: RunRowProps) {
  const durationMs = formatDurationMs(execution);
  const durationNumeric = durationMs ? Number(durationMs.replace(/,/g, "")) : null;
  const isSlow = durationNumeric !== null && durationNumeric > 5_000;
  const tone = statusTone(execution.status);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-3 border-border/40 border-b px-4 py-2",
        "text-left font-mono text-xs transition-colors",
        "hover:bg-foreground/[0.03]",
        isSelected && "bg-foreground/[0.05] hover:bg-foreground/[0.05]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          tone.dot,
          tone.pulse && "animate-pulse",
        )}
      />

      <span className="w-[120px] shrink-0 tabular-nums text-muted-foreground">
        {formatTimestamp(execution.createdAt)}
      </span>

      <span className="inline-flex w-[170px] shrink-0 gap-1">
        <span className="text-muted-foreground/60">status:</span>
        <span className={tone.text}>{statusWord(execution.status)}</span>
      </span>

      <span className="inline-flex w-[170px] shrink-0 gap-1">
        <span className="text-muted-foreground/60">duration_ms:</span>
        <span
          className={cn(
            durationMs === null && "text-muted-foreground/60",
            durationMs !== null && isSlow && "text-[color:var(--color-error)]",
            durationMs !== null && !isSlow && "text-[color:var(--color-success)]",
          )}
        >
          {durationMs ?? "—"}
        </span>
      </span>

      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground/60">code: </span>
        <span className="text-foreground/80">
          &quot;{truncateCode(execution.code, 160)}&quot;
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Header — `_time | Raw Data` (v1.3)
// ---------------------------------------------------------------------------

export function RunRowHeader() {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      <span className="size-2 shrink-0" aria-hidden />
      <span className="w-[120px] shrink-0">_time</span>
      <span>Raw Data</span>
    </div>
  );
}
