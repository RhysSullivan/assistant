import * as React from "react";
import { ShieldCheckIcon, RotateCcwIcon } from "lucide-react";

import {
  CardStack,
  CardStackContent,
  CardStackEntryField,
} from "../components/card-stack";
import { Button } from "../components/button";
import { FieldLabel } from "../components/field";
import { Switch } from "../components/switch";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Shared UX primitive — lets each source plugin render a per-source override
// for which tool invocations require approval before running.
//
// The component is presentational only: it takes a typed list of togglable
// tokens (HTTP methods for OpenAPI/Google Discovery, operation kinds for
// GraphQL, anything for future plugins) plus a per-token "default approval
// required" hint, and stores the user's explicit list in a local set. Pass
// `value === undefined` to render "using defaults"; the first interaction
// materializes a concrete list and emits it via onChange.
//
// The switch variant renders a single toggle for plugins whose policy is a
// simple on/off override (e.g. MCP, which defaults to no tool-level approval
// because servers handle elicitation mid-invocation).
// ---------------------------------------------------------------------------

export interface ApprovalPolicyToken {
  readonly value: string;
  readonly label: React.ReactNode;
  /** Short description shown under the label when rendered in "detail" mode. */
  readonly description?: React.ReactNode;
  /** Whether this token requires approval in the plugin's DEFAULT policy. */
  readonly defaultRequiresApproval: boolean;
  /** Visual tone. `safe` → green tint; `write` → amber/red tint; `neutral` → muted. */
  readonly tone?: "safe" | "write" | "neutral";
}

// Shared shell — title, description, reset button, children.
interface PolicyShellProps {
  readonly title?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly isOverridden: boolean;
  readonly onReset: () => void;
  readonly children: React.ReactNode;
}

function PolicyShell({
  title = "Approval policy",
  description,
  isOverridden,
  onReset,
  children,
}: PolicyShellProps) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel className="flex items-center gap-1.5">
          <ShieldCheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
          {title}
        </FieldLabel>
        {isOverridden && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onReset}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcwIcon aria-hidden className="size-3" />
            Reset to defaults
          </Button>
        )}
      </div>
      <CardStack>
        <CardStackContent className="border-t-0">
          <div className="flex flex-col gap-3 px-4 py-3">
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            {children}
            {!isOverridden && (
              <p className="text-[11px] text-muted-foreground/80">
                Using plugin defaults. Click any option to start overriding.
              </p>
            )}
          </div>
        </CardStackContent>
      </CardStack>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Toggles variant — one togglable chip per token. OpenAPI, Google Discovery,
// GraphQL all use this.
// ---------------------------------------------------------------------------

export interface ApprovalPolicyTogglesProps {
  readonly title?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly tokens: readonly ApprovalPolicyToken[];
  /**
   * Current explicit override — the set of token `value`s that require
   * approval. `undefined` means "use defaults" (the plugin's derived
   * behaviour). When `null` is emitted, the override has been cleared.
   */
  readonly value: readonly string[] | undefined;
  readonly onChange: (next: readonly string[] | undefined) => void;
  /**
   * Optional layout. `grid` (default) wraps chips in a responsive grid;
   * `list` stacks them vertically with room for descriptions.
   */
  readonly layout?: "grid" | "list";
}

const toneClasses: Record<"safe" | "write" | "neutral", string> = {
  safe:
    "data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-700 data-[active=true]:border-emerald-500/40 data-[active=true]:ring-emerald-500/20 dark:data-[active=true]:text-emerald-300",
  write:
    "data-[active=true]:bg-amber-500/15 data-[active=true]:text-amber-800 data-[active=true]:border-amber-500/50 data-[active=true]:ring-amber-500/20 dark:data-[active=true]:text-amber-200",
  neutral:
    "data-[active=true]:bg-primary/10 data-[active=true]:text-foreground data-[active=true]:border-primary/40 data-[active=true]:ring-primary/20",
};

export function ApprovalPolicyToggles({
  title,
  description,
  tokens,
  value,
  onChange,
  layout = "grid",
}: ApprovalPolicyTogglesProps) {
  // `value === undefined` means "using defaults". Derive the effective
  // selection set from defaults in that case so we can render chip state.
  const effective = React.useMemo(() => {
    if (value !== undefined) {
      return new Set(value.map((v) => v.toLowerCase()));
    }
    return new Set(
      tokens.filter((t) => t.defaultRequiresApproval).map((t) => t.value.toLowerCase()),
    );
  }, [value, tokens]);

  const isOverridden = value !== undefined;

  const toggle = (tokenValue: string) => {
    const next = new Set(effective);
    const key = tokenValue.toLowerCase();
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    // Preserve the canonical (original-cased) token values in the emitted
    // array so the backend receives the same literal strings the caller
    // declared.
    const canonical = tokens
      .filter((t) => next.has(t.value.toLowerCase()))
      .map((t) => t.value);
    onChange(canonical);
  };

  return (
    <PolicyShell
      title={title}
      description={description}
      isOverridden={isOverridden}
      onReset={() => onChange(undefined)}
    >
      <div
        className={cn(
          layout === "grid"
            ? "flex flex-wrap gap-1.5"
            : "flex flex-col gap-1",
        )}
      >
        {tokens.map((token) => {
          const active = effective.has(token.value.toLowerCase());
          const tone = token.tone ?? "neutral";
          return (
            <button
              key={token.value}
              type="button"
              data-active={active}
              aria-pressed={active}
              onClick={() => toggle(token.value)}
              className={cn(
                "group/policy-chip relative inline-flex items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium transition-all",
                "hover:bg-accent/40 hover:border-border",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                "data-[active=true]:ring-2 data-[active=true]:shadow-xs",
                toneClasses[tone],
                layout === "list" && "w-full justify-between text-left",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full transition-colors",
                    active
                      ? tone === "safe"
                        ? "bg-emerald-500"
                        : tone === "write"
                          ? "bg-amber-500"
                          : "bg-primary"
                      : "bg-muted-foreground/30",
                  )}
                />
                <span className="font-mono tracking-wide">{token.label}</span>
              </span>
              {layout === "list" && token.description && (
                <span className="truncate text-[11px] font-normal text-muted-foreground">
                  {token.description}
                </span>
              )}
              {token.defaultRequiresApproval && (
                <span
                  className={cn(
                    "rounded-sm bg-muted/60 px-1 py-px text-[9px] font-normal uppercase tracking-wider text-muted-foreground",
                    "group-data-[active=true]/policy-chip:bg-transparent group-data-[active=true]/policy-chip:text-current/60",
                  )}
                >
                  default
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground/80">
        Highlighted options require approval before a tool call runs. Click to toggle.
      </p>
    </PolicyShell>
  );
}

// ---------------------------------------------------------------------------
// Switch variant — single on/off override. MCP uses this.
// ---------------------------------------------------------------------------

export interface ApprovalPolicySwitchProps {
  readonly title?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly switchLabel: React.ReactNode;
  readonly switchDescription?: React.ReactNode;
  readonly defaultValue: boolean;
  /**
   * Current explicit override. `undefined` means "use defaults"; a boolean
   * means the user has pinned the override.
   */
  readonly value: boolean | undefined;
  readonly onChange: (next: boolean | undefined) => void;
}

export function ApprovalPolicySwitch({
  title,
  description,
  switchLabel,
  switchDescription,
  defaultValue,
  value,
  onChange,
}: ApprovalPolicySwitchProps) {
  const effective = value ?? defaultValue;
  const isOverridden = value !== undefined;
  return (
    <PolicyShell
      title={title}
      description={description}
      isOverridden={isOverridden}
      onReset={() => onChange(undefined)}
    >
      <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-background px-3 py-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{switchLabel}</span>
          {switchDescription && (
            <span className="text-xs text-muted-foreground">{switchDescription}</span>
          )}
        </div>
        <Switch
          checked={effective}
          onCheckedChange={(checked) => {
            // Allow toggling back to "default" by matching the default value.
            if (checked === defaultValue) {
              onChange(undefined);
            } else {
              onChange(checked);
            }
          }}
        />
      </div>
    </PolicyShell>
  );
}

// ---------------------------------------------------------------------------
// Token presets — keep the shape of "default requires approval" out of each
// plugin's UI by exporting canonical lists.
// ---------------------------------------------------------------------------

export const HTTP_METHOD_TOKENS: readonly ApprovalPolicyToken[] = [
  { value: "GET", label: "GET", tone: "safe", defaultRequiresApproval: false },
  { value: "HEAD", label: "HEAD", tone: "safe", defaultRequiresApproval: false },
  { value: "OPTIONS", label: "OPTIONS", tone: "safe", defaultRequiresApproval: false },
  { value: "POST", label: "POST", tone: "write", defaultRequiresApproval: true },
  { value: "PUT", label: "PUT", tone: "write", defaultRequiresApproval: true },
  { value: "PATCH", label: "PATCH", tone: "write", defaultRequiresApproval: true },
  { value: "DELETE", label: "DELETE", tone: "write", defaultRequiresApproval: true },
];

export const GRAPHQL_OPERATION_TOKENS: readonly ApprovalPolicyToken[] = [
  {
    value: "query",
    label: "query",
    tone: "safe",
    defaultRequiresApproval: false,
    description: "Read-only operations",
  },
  {
    value: "mutation",
    label: "mutation",
    tone: "write",
    defaultRequiresApproval: true,
    description: "Operations that change server state",
  },
];
