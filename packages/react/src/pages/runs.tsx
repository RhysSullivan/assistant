import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ExecutionStatus } from "@executor/sdk";

import { listExecutions, type ExecutionListItem } from "../api/executions";
import { RunsShell } from "../components/runs/shell";
import { RunRow, RunRowHeader } from "../components/runs/row";
import {
  RunsFilterRail,
  resolveTimeRange,
  type TimeRangePreset,
} from "../components/runs/filter-rail";
import { TimelineChart } from "../components/runs/timeline-chart";
import { RunsDetailDrawer } from "../components/runs/detail-drawer";
import { STATUS_ORDER } from "../components/runs/status";

// ---------------------------------------------------------------------------
// /runs — observability-style execution history
// ---------------------------------------------------------------------------
//
// Layout from openstatus-data-table's /infinite example. Row aesthetic,
// drawer, and status vocabulary from v1.3's execution-history plugin.
// URL state is the single source of truth — TanStack Router search params
// drive every filter, and the drawer open state is just `?executionId=`.

export type RunsSearch = {
  readonly executionId?: string;
  readonly status?: string;
  readonly range?: string;
  readonly from?: string;
  readonly to?: string;
  readonly code?: string;
};

const DEFAULT_RANGE: TimeRangePreset = "24h";
const VALID_RANGES: readonly TimeRangePreset[] = ["15m", "1h", "24h", "7d", "30d", "all"];
const PAGE_SIZE = 50;

const parseStatuses = (value: string | undefined): ExecutionStatus[] =>
  value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry): entry is ExecutionStatus =>
          STATUS_ORDER.includes(entry as ExecutionStatus),
        )
    : [];

const parseRange = (value: string | undefined): TimeRangePreset => {
  if (!value) return DEFAULT_RANGE;
  return VALID_RANGES.includes(value as TimeRangePreset)
    ? (value as TimeRangePreset)
    : DEFAULT_RANGE;
};

const toggleStatus = (
  statuses: readonly ExecutionStatus[],
  status: ExecutionStatus,
): ExecutionStatus[] =>
  statuses.includes(status)
    ? statuses.filter((entry) => entry !== status)
    : [...statuses, status].sort();

export function RunsPage({ search }: { search: RunsSearch }) {
  const navigate = useNavigate();

  const selectedStatuses = React.useMemo(() => parseStatuses(search.status), [search.status]);
  const range = React.useMemo(() => parseRange(search.range), [search.range]);

  const [codeInput, setCodeInput] = React.useState(search.code ?? "");

  React.useEffect(() => {
    setCodeInput(search.code ?? "");
  }, [search.code]);

  const updateSearch = React.useCallback(
    (patch: Partial<RunsSearch>) => {
      void navigate({
        to: "/runs",
        replace: true,
        search: (current: RunsSearch) => {
          const next = { ...current, ...patch };
          const cleaned: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(next)) {
            if (value && String(value).length > 0) {
              cleaned[key] = String(value);
            }
          }
          return cleaned as RunsSearch;
        },
      });
    },
    [navigate],
  );

  // Debounce code input → URL state
  React.useEffect(() => {
    const trimmed = codeInput.trim();
    const current = search.code ?? "";
    if (trimmed === current) return;

    const timeout = window.setTimeout(() => {
      updateSearch({ code: trimmed || undefined, executionId: undefined });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [codeInput, search.code, updateSearch]);

  // Resolve time range — custom from/to takes precedence over preset
  const resolvedTimeRange = React.useMemo(() => {
    if (search.from || search.to) {
      return {
        from: search.from ? Number(search.from) : undefined,
        to: search.to ? Number(search.to) : undefined,
      };
    }
    return resolveTimeRange(range);
  }, [range, search.from, search.to]);

  const listQuery = useInfiniteQuery({
    queryKey: [
      "executions",
      selectedStatuses.join(","),
      resolvedTimeRange.from ?? "",
      resolvedTimeRange.to ?? "",
      search.code ?? "",
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listExecutions({
        limit: PAGE_SIZE,
        cursor: pageParam,
        status: selectedStatuses.length > 0 ? selectedStatuses.join(",") : undefined,
        from: resolvedTimeRange.from ? String(resolvedTimeRange.from) : undefined,
        to: resolvedTimeRange.to ? String(resolvedTimeRange.to) : undefined,
        code: search.code,
      }),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 10_000,
  });

  const rows = React.useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.executions) ?? [],
    [listQuery.data],
  );

  // Meta is only returned on the first page request — pin it
  const meta = listQuery.data?.pages[0]?.meta;

  const totalsLine = meta
    ? `${meta.filterRowCount.toLocaleString()} of ${meta.totalRowCount.toLocaleString()} runs`
    : undefined;

  const handleToggleStatus = React.useCallback(
    (status: ExecutionStatus) => {
      const next = toggleStatus(selectedStatuses, status);
      updateSearch({
        status: next.length > 0 ? next.join(",") : undefined,
        executionId: undefined,
      });
    },
    [selectedStatuses, updateSearch],
  );

  const handleRangeChange = React.useCallback(
    (nextRange: TimeRangePreset) => {
      updateSearch({
        range: nextRange,
        from: undefined,
        to: undefined,
        executionId: undefined,
      });
    },
    [updateSearch],
  );

  const handleCodeQueryChange = React.useCallback((value: string) => {
    setCodeInput(value);
  }, []);

  const handleReset = React.useCallback(() => {
    setCodeInput("");
    updateSearch({
      status: undefined,
      range: DEFAULT_RANGE,
      from: undefined,
      to: undefined,
      code: undefined,
      executionId: undefined,
    });
  }, [updateSearch]);

  const handleChartRangeSelect = React.useCallback(
    ({ from, to }: { from: number; to: number }) => {
      updateSearch({
        range: undefined,
        from: String(from),
        to: String(to),
        executionId: undefined,
      });
    },
    [updateSearch],
  );

  const handleRowSelect = React.useCallback(
    (execution: ExecutionListItem) => {
      updateSearch({
        executionId: search.executionId === execution.id ? undefined : execution.id,
      });
    },
    [search.executionId, updateSearch],
  );

  const handleDrawerOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        updateSearch({ executionId: undefined });
      }
    },
    [updateSearch],
  );

  return (
    <>
      <RunsShell
        filterRail={
          <RunsFilterRail
            selectedStatuses={selectedStatuses}
            onToggleStatus={handleToggleStatus}
            range={range}
            onRangeChange={handleRangeChange}
            codeQuery={codeInput}
            onCodeQueryChange={handleCodeQueryChange}
            onReset={handleReset}
            meta={meta}
            totalsLine={totalsLine}
          />
        }
        topBar={
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-3 font-mono text-[11px] text-muted-foreground/60">
              <span className="uppercase tracking-wider">
                {rows.length.toLocaleString()} loaded
              </span>
              {meta ? (
                <span className="uppercase tracking-wider">
                  · {meta.filterRowCount.toLocaleString()} total
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isRefetching}
              className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 hover:text-foreground disabled:opacity-40"
            >
              {listQuery.isRefetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
        chartSlot={
          meta ? (
            <TimelineChart
              data={meta.chartData}
              bucketMs={meta.chartBucketMs}
              onRangeSelect={handleChartRangeSelect}
            />
          ) : null
        }
        columnHeader={<RunRowHeader />}
        isLoading={listQuery.isLoading}
        isFetchingNextPage={listQuery.isFetchingNextPage}
        hasNextPage={listQuery.hasNextPage}
        fetchNextPage={() => void listQuery.fetchNextPage()}
        totalRowsFetched={rows.length}
        filterRowCount={meta?.filterRowCount}
        emptyState={
          <div className="text-center">
            <p className="font-mono text-xs text-foreground/80">No runs match the current filters.</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
              Try widening the time range or removing the status filter.
            </p>
          </div>
        }
      >
        {rows.map((row) => (
          <RunRow
            key={row.id}
            execution={row}
            isSelected={search.executionId === row.id}
            onSelect={() => handleRowSelect(row)}
          />
        ))}
      </RunsShell>

      <RunsDetailDrawer
        executionId={search.executionId}
        onOpenChange={handleDrawerOpenChange}
      />
    </>
  );
}
