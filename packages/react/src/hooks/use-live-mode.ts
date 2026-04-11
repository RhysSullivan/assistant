import * as React from "react";

// ---------------------------------------------------------------------------
// useLiveMode — compute the live cutoff for the /runs list
// ---------------------------------------------------------------------------
//
// Port of openstatus-data-table's `useLiveMode`. The semantics:
//
//   1. When live mode turns ON, freeze `cutoffTimestamp` to the current
//      newest row's createdAt.
//   2. Rows with `createdAt > cutoffTimestamp` are "new since you went
//      live" — render at full opacity.
//   3. Rows with `createdAt <= cutoffTimestamp` are "past" — render at
//      half opacity.
//   4. The topmost row at or below the cutoff is the `cutoffRowId` —
//      the UI renders a `<LiveRow>` divider above it.
//
// When live mode turns OFF, the cutoff clears and nothing fades.

export interface LiveModeState<T> {
  readonly cutoffTimestamp: number | null;
  readonly cutoffRow: T | null;
  readonly isPast: (createdAt: number) => boolean;
}

export function useLiveMode<T extends { readonly id: string; readonly createdAt: number }>(
  rows: readonly T[],
  live: boolean,
): LiveModeState<T> {
  const [cutoffTimestamp, setCutoffTimestamp] = React.useState<number | null>(null);

  // `rows` is non-reactive here — we only want to read its latest value
  // when `live` transitions, not re-run the effect every time a new row
  // arrives. `useEffectEvent` is exactly this: the event sees the
  // freshest `rows` at the transition moment while the surrounding
  // effect's sole reactive dependency stays `live`. See
  // https://react.dev/reference/react/useEffectEvent
  const onLiveChange = React.useEffectEvent((isLive: boolean) => {
    if (!isLive) {
      setCutoffTimestamp(null);
      return;
    }
    const newest = rows[0];
    setCutoffTimestamp(newest ? newest.createdAt : Date.now());
  });

  React.useEffect(() => {
    onLiveChange(live);
  }, [live]);

  const cutoffRow = React.useMemo(() => {
    if (cutoffTimestamp === null) return null;
    return rows.find((row) => row.createdAt <= cutoffTimestamp) ?? null;
  }, [rows, cutoffTimestamp]);

  const isPast = React.useCallback(
    (createdAt: number): boolean => {
      if (cutoffTimestamp === null) return false;
      return createdAt <= cutoffTimestamp;
    },
    [cutoffTimestamp],
  );

  return { cutoffTimestamp, cutoffRow, isPast };
}
