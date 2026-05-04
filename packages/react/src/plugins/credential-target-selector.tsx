import * as React from "react";
import { Label } from "../components/label";
import { NativeSelect, NativeSelectOption } from "../components/native-select";
import type { ScopeId } from "@executor-js/sdk";

import { useActiveWriteScopeId, useScopeStack } from "../api/scope-context";

// ---------------------------------------------------------------------------
// CredentialTargetSelector — visible chooser for the scope a credential
// (secret / connection / policy) write should land at. Unlike source
// definitions, credentials are valid at every scope in the URL context's
// stack, including the personal scopes. The plan in
// `notes/cloud-workspaces-and-global-sources-plan.md` calls out four
// labels:
//
//   - Only me in this workspace  → user-workspace
//   - Everyone in this workspace → workspace
//   - Only me across this org    → user-org
//   - Everyone in this org       → org
//
// In global context only the latter two are visible. The default
// selection is the URL context's active write scope (`org` global,
// `workspace` workspace) — pre-fills a "team-wide" target while still
// letting the user opt into a personal override.
//
// Local CLI hosts have a single-scope stack; the selector renders a single
// option labeled with the scope's display name and disables the dropdown.
// ---------------------------------------------------------------------------

export interface CredentialTargetOption {
  readonly scopeId: ScopeId;
  readonly label: string;
  /** Hint for ordering / grouping. Not used for matching. */
  readonly kind: "user-workspace" | "workspace" | "user-org" | "org" | "other";
}

const kindFor = (id: string): CredentialTargetOption["kind"] => {
  if (id.startsWith("user_workspace_")) return "user-workspace";
  if (id.startsWith("workspace_")) return "workspace";
  if (id.startsWith("user_org_")) return "user-org";
  if (id.startsWith("org_")) return "org";
  return "other";
};

const labelFor = (id: string, name: string, kind: CredentialTargetOption["kind"]): string => {
  switch (kind) {
    case "user-workspace":
      return "Only me in this workspace";
    case "workspace":
      return `Everyone in ${name}`;
    case "user-org":
      return "Only me across this org";
    case "org":
      return `Everyone in ${name}`;
    default:
      return name;
  }
};

/**
 * Returns the legal credential targets for the current URL context, in
 * display order: most personal → most shared. In a workspace context that
 * is `[user-workspace, workspace, user-org, org]`; in global it is
 * `[user-org, org]`. The cloud's executor stack already lists scopes
 * innermost-first, so this is just a relabel + label-merge.
 */
export function useCredentialTargetOptions(): readonly CredentialTargetOption[] {
  const stack = useScopeStack();
  return React.useMemo(() => {
    const options: CredentialTargetOption[] = [];
    for (const entry of stack) {
      const kind = kindFor(entry.id);
      options.push({
        scopeId: entry.id,
        kind,
        label: labelFor(entry.id, entry.name, kind),
      });
    }
    return options;
  }, [stack]);
}

export interface CredentialTargetSelectorProps {
  readonly value: ScopeId;
  readonly onChange: (next: ScopeId) => void;
  readonly disabled?: boolean;
  /** Override the default label "Save to". */
  readonly label?: string;
  readonly id?: string;
}

/**
 * Visible target selector for credential write forms (secrets, connection
 * tokens, policies). Always renders even when there's only one option —
 * the selector documents the explicit target and matches the plan's
 * "no hidden defaults" invariant.
 */
export function CredentialTargetSelector(props: CredentialTargetSelectorProps) {
  const options = useCredentialTargetOptions();
  const fallbackId = useId();
  const id = props.id ?? fallbackId;

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{props.label ?? "Save to"}</Label>
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
 * Hook for managed credential-target state. Returns the selected target
 * plus a setter, defaulting to the URL context's active write scope. The
 * default lines up with "team-wide" (workspace in workspace context, org
 * global). Callers pass `value` into the API call's `params.scopeId` and
 * render `<CredentialTargetSelector>` over `value` + `setValue`.
 */
export function useCredentialTargetState(): {
  readonly value: ScopeId;
  readonly setValue: (next: ScopeId) => void;
  readonly options: readonly CredentialTargetOption[];
} {
  const defaultId = useActiveWriteScopeId();
  const options = useCredentialTargetOptions();
  const [value, setValue] = React.useState<ScopeId>(defaultId);
  React.useEffect(() => {
    if (!options.some((o) => o.scopeId === value)) {
      setValue(defaultId);
    }
  }, [defaultId, options, value]);
  return { value, setValue, options };
}

function useId(): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const useIdImpl = (React as any).useId as (() => string) | undefined;
  const ref = React.useRef<string | null>(null);
  if (useIdImpl) return useIdImpl();
  if (ref.current === null) {
    ref.current = `credential-target-${Math.random().toString(36).slice(2)}`;
  }
  return ref.current;
}
