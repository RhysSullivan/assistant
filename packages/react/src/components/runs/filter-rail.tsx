import * as React from "react";
import type { ExecutionListMeta, ExecutionStatus } from "@executor/sdk";

import { cn } from "../../lib/utils";
import { Input } from "../input";
import { STATUS_ORDER, STATUS_LABELS, statusTone } from "./status";

// ---------------------------------------------------------------------------
// FilterRail — left rail with page title, status facets, range, code input
// ---------------------------------------------------------------------------
//
// Openstatus `/infinite` puts `<DataTableFilterControls>` in a sticky left
// rail. We do the same but with v1.3 density: header = `font-display`
// page title + muted subtitle, then a status facet list (dot + label +
// checkbox + count), then a time-range preset group, then a code contains
// input.

export interface RunsFilterRailProps {
  readonly selectedStatuses: readonly ExecutionStatus[];
  readonly onToggleStatus: (status: ExecutionStatus) => void;
  readonly range: TimeRangePreset;
  readonly onRangeChange: (range: TimeRangePreset) => void;
  readonly codeQuery: string;
  readonly onCodeQueryChange: (value: string) => void;
  readonly onReset: () => void;
  readonly meta?: ExecutionListMeta;
  readonly totalsLine?: string;
}

export type TimeRangePreset = "15m" | "1h" | "24h" | "7d" | "30d" | "all";

export const TIME_RANGE_PRESETS: readonly {
  readonly value: TimeRangePreset;
  readonly label: string;
}[] = [
  { value: "15m", label: "Last 15m" },
  { value: "1h", label: "Last 1h" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "all", label: "All time" },
];

/** Resolve a preset to an epoch-ms [from, to] pair. `to` is always "now". */
export const resolveTimeRange = (
  preset: TimeRangePreset,
): { readonly from?: number; readonly to?: number } => {
  if (preset === "all") return {};
  const now = Date.now();
  const deltaMs: Record<Exclude<TimeRangePreset, "all">, number> = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return { from: now - deltaMs[preset], to: now };
};

export function RunsFilterRail({
  selectedStatuses,
  onToggleStatus,
  range,
  onRangeChange,
  codeQuery,
  onCodeQueryChange,
  onReset,
  meta,
  totalsLine,
}: RunsFilterRailProps) {
  const filtersActive =
    selectedStatuses.length > 0 || codeQuery.trim().length > 0 || range !== "24h";

  return (
    <div className="flex h-full flex-col">
      {/* Title block */}
      <div className="border-border border-b px-4 py-5">
        <h1 className="font-display text-xl tracking-tight text-foreground">
          Execution history
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Every execution recorded for this scope, newest first.
        </p>
        {totalsLine ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {totalsLine}
          </p>
        ) : null}
      </div>

      {/* Filters header + reset */}
      <div className="flex items-center justify-between border-border/60 border-b px-4 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Filters
        </p>
        {filtersActive ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 hover:text-foreground"
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Status facets */}
        <FacetGroup label="Status">
          {STATUS_ORDER.map((status) => {
            const tone = statusTone(status);
            const checked = selectedStatuses.includes(status);
            const count = meta?.statusCounts[status];
            return (
              <li key={status}>
                <button
                  type="button"
                  onClick={() => onToggleStatus(status)}
                  className={cn(
                    "group flex w-full items-center gap-2.5 py-1 text-left text-xs",
                    "text-muted-foreground hover:text-foreground",
                    checked && "text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-border",
                      checked && "border-foreground bg-foreground/10",
                    )}
                    aria-hidden
                  >
                    {checked ? (
                      <svg viewBox="0 0 12 12" className="size-2.5 text-foreground">
                        <path
                          d="M2 6l3 3 5-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>

                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", tone.dot, tone.pulse && "animate-pulse")}
                  />

                  <span className="flex-1 truncate">{STATUS_LABELS[status]}</span>

                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50">
                    {count ?? ""}
                  </span>
                </button>
              </li>
            );
          })}
        </FacetGroup>

        {/* Time range */}
        <FacetGroup label="Time range">
          {TIME_RANGE_PRESETS.map((preset) => {
            const active = preset.value === range;
            return (
              <li key={preset.value}>
                <button
                  type="button"
                  onClick={() => onRangeChange(preset.value)}
                  className={cn(
                    "flex w-full items-center gap-2.5 py-1 text-left text-xs",
                    "text-muted-foreground hover:text-foreground",
                    active && "text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-border",
                      active && "border-foreground",
                    )}
                    aria-hidden
                  >
                    {active ? (
                      <span className="size-1.5 rounded-full bg-foreground" />
                    ) : null}
                  </span>
                  <span className="flex-1">{preset.label}</span>
                </button>
              </li>
            );
          })}
        </FacetGroup>

        {/* Code contains */}
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Code contains
          </p>
          <Input
            type="text"
            value={codeQuery}
            onChange={(event) => onCodeQueryChange(event.currentTarget.value)}
            placeholder="tools.github.list"
            className="h-8 font-mono text-[11px]"
          />
        </div>
      </div>
    </div>
  );
}

function FacetGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <ul className="space-y-0">{children}</ul>
    </div>
  );
}
