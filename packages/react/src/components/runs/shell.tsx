import * as React from "react";

import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// RunsShell — split-screen observability layout
// ---------------------------------------------------------------------------
//
// Shape borrowed from openstatus-data-table's `DataTableInfinite` and trimmed
// to what /runs actually needs:
//   ┌────────────┬────────────────────────────────────────────┐
//   │ filterRail │ topBar (toolbar + chartSlot)                │
//   │            ├────────────────────────────────────────────┤
//   │            │ columnHeader (_time | Raw Data)             │
//   │            ├────────────────────────────────────────────┤
//   │            │ body (scrollable, fetchNextPage on bottom)  │
//   │            │                                             │
//   │            │                                             │
//   │            │                                             │
//   │            └────────────────────────────────────────────┘
//
// No TanStack Table, no BYOS store, no column model — the body is just a
// vertical list of whatever rows the caller renders. Pagination is driven by
// an onScroll hook on the body, matching openstatus's approach.
//
// v1.3 aesthetic: no outer card/border radius around the list, no alternating
// row background, dense mono typography.

export interface RunsShellProps {
  readonly filterRail: React.ReactNode;
  readonly topBar?: React.ReactNode;
  readonly chartSlot?: React.ReactNode;
  readonly columnHeader?: React.ReactNode;
  readonly emptyState?: React.ReactNode;
  readonly isLoading?: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly hasNextPage?: boolean;
  readonly fetchNextPage?: () => void;
  readonly totalRowsFetched?: number;
  readonly filterRowCount?: number;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function RunsShell({
  filterRail,
  topBar,
  chartSlot,
  columnHeader,
  emptyState,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  totalRowsFetched = 0,
  filterRowCount,
  children,
  className,
}: RunsShellProps) {
  const topBarRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [topBarHeight, setTopBarHeight] = React.useState(0);

  React.useEffect(() => {
    const topBar = topBarRef.current;
    if (!topBar) return;

    const observer = new ResizeObserver(() => {
      const rect = topBar.getBoundingClientRect();
      setTopBarHeight(rect.height);
    });

    observer.observe(topBar);
    return () => observer.disconnect();
  }, []);

  const onScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!fetchNextPage || !hasNextPage || isFetchingNextPage) return;

      const target = event.currentTarget;
      const onPageBottom =
        Math.ceil(target.scrollTop + target.clientHeight) >= target.scrollHeight - 64;

      if (onPageBottom) {
        const hitFilterCeiling =
          typeof filterRowCount === "number" && totalRowsFetched >= filterRowCount;
        if (!hitFilterCeiling) {
          fetchNextPage();
        }
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage, totalRowsFetched, filterRowCount],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col sm:flex-row",
        "bg-background text-foreground",
        className,
      )}
      style={
        {
          "--runs-top-bar-height": `${topBarHeight}px`,
        } as React.CSSProperties
      }
    >
      {/* Left rail */}
      <aside
        className={cn(
          "sticky top-0 z-10 flex h-screen w-full shrink-0 flex-col self-start",
          "sm:max-w-60 sm:min-w-60 md:max-w-72 md:min-w-72",
          "border-border sm:border-r",
          "hidden sm:flex",
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">{filterRail}</div>
      </aside>

      {/* Main pane */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Sticky top bar */}
        <div
          ref={topBarRef}
          className={cn(
            "sticky top-0 z-10 flex flex-col gap-3",
            "border-border border-b bg-background px-4 pt-3 pb-3",
          )}
        >
          {topBar}
          {chartSlot}
        </div>

        {/* Column header */}
        {columnHeader ? (
          <div className="sticky top-[var(--runs-top-bar-height)] z-10 border-border/60 border-b bg-background">
            {columnHeader}
          </div>
        ) : null}

        {/* Scrollable body */}
        <div
          ref={bodyRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto"
        >
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-xs font-mono text-muted-foreground">
              Loading runs…
            </div>
          ) : !hasRows(children) ? (
            <div className="flex h-full min-h-48 items-center justify-center px-4 py-8">
              {emptyState ?? (
                <p className="text-xs font-mono text-muted-foreground">No runs.</p>
              )}
            </div>
          ) : (
            <>
              {children}
              {isFetchingNextPage ? (
                <div className="flex items-center justify-center border-border/50 border-b py-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60">
                  Loading more…
                </div>
              ) : null}
              {!hasNextPage && totalRowsFetched > 0 ? (
                <div className="flex items-center justify-center py-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40">
                  End of history
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * React children can be a single element, an array, a fragment, or null.
 * We only want to show the empty state when there are *no* row children,
 * but React.Children.count() returns 1 for a fragment with 0 rows. So we
 * walk a level deeper when the child is a fragment or array.
 */
function hasRows(children: React.ReactNode): boolean {
  const count = React.Children.count(children);
  if (count === 0) return false;

  let found = false;
  React.Children.forEach(children, (child) => {
    if (found) return;
    if (child == null || typeof child === "boolean") return;
    if (
      typeof child === "object" &&
      "type" in child &&
      child.type === React.Fragment &&
      "props" in child &&
      child.props &&
      typeof child.props === "object" &&
      "children" in child.props
    ) {
      found = hasRows(child.props.children as React.ReactNode);
      return;
    }
    found = true;
  });
  return found;
}
