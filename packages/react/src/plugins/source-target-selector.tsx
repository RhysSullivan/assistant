import * as React from "react";
import { Label } from "../components/label";
import { NativeSelect, NativeSelectOption } from "../components/native-select";
import type { ScopeId } from "@executor-js/sdk";

import { useActiveWriteScopeId, useScopeStack } from "../api/scope-context";

// ---------------------------------------------------------------------------
// SourceTargetSelector — visible chooser for the scope a source-definition
// write should land at. The cloud's plan calls out two legal targets:
//
//   - Workspace (`workspace_<id>`) — only in workspace context.
//   - Global   (`org_<id>`)        — always available.
//
// Personal scopes (`user_org_*`, `user_workspace_*`) are NOT valid targets
// for source definitions in v1 — they're filtered out here AND rejected by
// the SDK (`InvalidSourceWriteTargetError`).
//
// The default selection is the URL context's active write scope:
//   - Workspace context → workspace.
//   - Global context    → org (only option).
//
// Local CLI hosts have a single-scope stack with no `workspace_*` /
// `user_*` prefixes; the selector gracefully degrades to a single option
// labeled with the scope's display name.
// ---------------------------------------------------------------------------

export interface SourceTargetOption {
  readonly scopeId: ScopeId;
  readonly label: string;
}

const isPersonalScope = (id: string): boolean =>
  id.startsWith("user_org_") || id.startsWith("user_workspace_");

const labelFor = (id: string, name: string): string => {
  if (id.startsWith("workspace_")) return `Workspace (${name})`;
  if (id.startsWith("org_")) return `Global (${name})`;
  return name;
};

/**
 * Returns the legal source-definition targets for the current URL context,
 * in display order: workspace first, then global. Personal scopes are
 * excluded — see `InvalidSourceWriteTargetError`.
 */
export function useSourceTargetOptions(): readonly SourceTargetOption[] {
  const stack = useScopeStack();
  return React.useMemo(() => {
    const options: SourceTargetOption[] = [];
    // Stack is innermost-first, so workspace lands first when present and
    // org lands at the end. We keep that order.
    for (const entry of stack) {
      if (isPersonalScope(entry.id)) continue;
      options.push({
        scopeId: entry.id,
        label: labelFor(entry.id, entry.name),
      });
    }
    return options;
  }, [stack]);
}

export interface SourceTargetSelectorProps {
  readonly value: ScopeId;
  readonly onChange: (next: ScopeId) => void;
  readonly disabled?: boolean;
  /** Override the default label "Add to". */
  readonly label?: string;
  readonly id?: string;
}

/**
 * Visible target selector for add-source forms. Always renders even when
 * there's only one option — the selector documents the explicit target
 * and matches the plan's "no hidden defaults" invariant.
 */
export function SourceTargetSelector(props: SourceTargetSelectorProps) {
  const options = useSourceTargetOptions();
  const fallbackId = useId();
  const id = props.id ?? fallbackId;

  if (options.length === 0) {
    // Should not happen — every executor stack has at least one
    // shareable scope. Render nothing so the form still submits.
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{props.label ?? "Add to"}</Label>
      <NativeSelect
        id={id}
        value={props.value}
        disabled={props.disabled || options.length === 1}
        onChange={(e) => props.onChange(e.target.value as ScopeId)}
      >
        {options.map((opt) => (
          <NativeSelectOption key={opt.scopeId} value={opt.scopeId}>
            {opt.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/**
 * Hook for managed selector state. Returns the selected target plus a
 * setter, defaulting to the URL context's active write scope. Callers
 * pass the returned `value` into the API call's `params.scopeId` and
 * render `<SourceTargetSelector>` over `value` + `setValue`.
 */
export function useSourceTargetState(): {
  readonly value: ScopeId;
  readonly setValue: (next: ScopeId) => void;
  readonly options: readonly SourceTargetOption[];
} {
  const defaultId = useActiveWriteScopeId();
  const options = useSourceTargetOptions();
  const [value, setValue] = React.useState<ScopeId>(defaultId);
  // If the selected scope falls out of the legal set (e.g. URL context
  // navigated away from workspace), snap back to the active write scope.
  React.useEffect(() => {
    if (!options.some((o) => o.scopeId === value)) {
      setValue(defaultId);
    }
  }, [defaultId, options, value]);
  return { value, setValue, options };
}

// useId wrapper — older React versions may not have `React.useId`; reading
// it as a property keeps tree-shake friendly and avoids breaking older tests.
function useId(): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const useIdImpl = (React as any).useId as (() => string) | undefined;
  // Fallback: stable per-mount id derived from a Math.random ref.
  const ref = React.useRef<string | null>(null);
  if (useIdImpl) return useIdImpl();
  if (ref.current === null) {
    ref.current = `source-target-${Math.random().toString(36).slice(2)}`;
  }
  return ref.current;
}
