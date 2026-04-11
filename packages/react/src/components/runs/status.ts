import type { ExecutionStatus } from "@executor/sdk";

// ---------------------------------------------------------------------------
// Shared status vocabulary
// ---------------------------------------------------------------------------
//
// Single source of truth for how every surface in the /runs page names and
// colors execution statuses: log-line rows, filter rail checkboxes, chart
// bars, and the detail drawer. v1.3 used inline `bg-*` Tailwind classes
// with a small amount of animate-pulse for live-ish states; we keep that
// but drive colors through our semantic CSS vars so light/dark inherit.

export const STATUS_ORDER = [
  "running",
  "waiting_for_interaction",
  "completed",
  "failed",
  "cancelled",
  "pending",
] as const satisfies readonly ExecutionStatus[];

export const STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending: "Pending",
  running: "Running",
  waiting_for_interaction: "Waiting",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export type StatusTone = {
  /** Tailwind bg-* class for the solid dot. */
  readonly dot: string;
  /** Tailwind text-* class for the inline status label. */
  readonly text: string;
  /** CSS value suitable for recharts bar `fill`. */
  readonly chartFill: string;
  /** Whether to apply `animate-pulse` to the dot. */
  readonly pulse: boolean;
};

export const STATUS_TONES: Record<ExecutionStatus, StatusTone> = {
  completed: {
    dot: "bg-[color:var(--color-success)]",
    text: "text-[color:var(--color-success)]",
    chartFill: "var(--color-success)",
    pulse: false,
  },
  failed: {
    dot: "bg-[color:var(--color-error)]",
    text: "text-[color:var(--color-error)]",
    chartFill: "var(--color-error)",
    pulse: false,
  },
  running: {
    dot: "bg-[color:var(--color-info)]",
    text: "text-[color:var(--color-info)]",
    chartFill: "var(--color-info)",
    pulse: true,
  },
  waiting_for_interaction: {
    dot: "bg-[color:var(--color-warning)]",
    text: "text-[color:var(--color-warning)]",
    chartFill: "var(--color-warning)",
    pulse: true,
  },
  cancelled: {
    dot: "bg-muted-foreground/60",
    text: "text-muted-foreground",
    chartFill: "var(--muted-foreground)",
    pulse: false,
  },
  pending: {
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    chartFill: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)",
    pulse: false,
  },
};

export const statusLabel = (status: ExecutionStatus): string => STATUS_LABELS[status];
export const statusTone = (status: ExecutionStatus): StatusTone => STATUS_TONES[status];
