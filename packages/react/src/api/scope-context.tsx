import * as React from "react";
import { useLocation } from "@tanstack/react-router";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import type { ScopeId } from "@executor-js/sdk";
import { scopeAtom } from "./atoms";
import { parseUrlContext } from "./url-context";

// ---------------------------------------------------------------------------
// Scope context — bridges the server's `/scope/info` payload into React.
//
// The server returns three things:
//
//   - `id` / `name` / `dir` for the active display/write scope
//     (`org_<id>` global, `workspace_<id>` workspace).
//   - `activeWriteScopeId` — explicit field for the default source-definition
//     write target. Same value as `id` today, but kept distinct so callers can
//     opt into "give me the default write target" without depending on the
//     display-vs-write distinction blurring later.
//   - `stack` — the full innermost-first scope stack. Drives storage-target
//     selectors ("Only me in this workspace" → user-workspace,
//     "Everyone in this workspace" → workspace, etc.) and inherited resource
//     labelling.
//
// Which hook to use:
//
//   - `useActiveWriteScopeId()` — default source-definition writes. Use this
//     for source list reads (the executor walks the stack on read), source
//     refresh/remove operations, and the default selection in add-source UIs.
//   - `useUserScope()` — personal-only resources. The innermost scope in the
//     stack (user-workspace in workspace context, user-org in global).
//   - `useScopeStack()` — for storage-target selectors that need the full
//     stack of choices.
//   - `useScopeInfo()` — the raw server payload, when a component needs more
//     than one piece (display name + active id + stack).
//   - `useScope()` — DEPRECATED alias for `useActiveWriteScopeId()`. Existing
//     callers continue to work; new code should pick the more specific hook.
// ---------------------------------------------------------------------------

export interface ScopeStackEntry {
  readonly id: ScopeId;
  readonly name: string;
  readonly dir: string;
}

export interface ScopeInfo {
  readonly id: ScopeId;
  readonly name: string;
  readonly dir: string;
  readonly activeWriteScopeId: ScopeId;
  readonly stack: readonly ScopeStackEntry[];
}

const ScopeContext = React.createContext<ScopeInfo | null>(null);

/**
 * Provides the server scope to all children.
 * Renders the optional `fallback` until the scope is fetched.
 *
 * The scope endpoint's response depends on the URL context — the cloud
 * middleware builds a workspace executor when the URL has `/:org/:workspace`
 * and a global executor otherwise — so `scopeAtom`'s cache must invalidate
 * when the user navigates between contexts. We watch `window.location.pathname`
 * (parsed via `parseUrlContext`) and trigger a refresh whenever the active
 * org/workspace pair changes. The cached value is reused inside a single
 * context (cheap re-renders don't refetch).
 */
export function ScopeProvider(props: React.PropsWithChildren<{ fallback?: React.ReactNode }>) {
  const result = useAtomValue(scopeAtom);
  const refresh = useAtomRefresh(scopeAtom);
  const contextKey = useUrlContextKey();
  const lastKey = React.useRef(contextKey);
  React.useEffect(() => {
    if (lastKey.current !== contextKey) {
      lastKey.current = contextKey;
      refresh();
    }
  }, [contextKey, refresh]);

  if (AsyncResult.isSuccess(result)) {
    return <ScopeContext.Provider value={result.value}>{props.children}</ScopeContext.Provider>;
  }

  return <>{props.fallback ?? null}</>;
}

/**
 * Returns a stable cache key derived from the active URL context. Different
 * `/:org` and `/:org/:workspace` paths produce different keys; same context
 * with different leaf paths returns the same key (so we don't refetch on
 * page navigation within the same scope stack).
 */
function useUrlContextKey(): string {
  const location = useLocation();
  return React.useMemo(() => {
    const ctx = parseUrlContext(location.pathname);
    if (ctx.kind === "workspace")
      return `ws:${ctx.orgHandle}/${ctx.workspaceSlug}`;
    if (ctx.kind === "global") return `org:${ctx.orgHandle}`;
    return "none";
  }, [location.pathname]);
}

/**
 * Returns the active display/write scope id. Prefer `useActiveWriteScopeId()`
 * for new code — this hook is kept as an alias so existing callers don't
 * churn. The two return the same value today.
 */
export function useScope(): ScopeId {
  return useActiveWriteScopeId();
}

/**
 * Returns the active source-definition write target id. `org_<id>` in global
 * context, `workspace_<id>` in workspace context. Reads via this scope walk
 * the executor's full stack server-side, so list endpoints called with this
 * id include inherited resources from outer scopes.
 *
 * Must be used inside a ScopeProvider.
 */
export function useActiveWriteScopeId(): ScopeId {
  const scope = React.useContext(ScopeContext);
  if (scope === null) {
    throw new Error("useActiveWriteScopeId must be used inside a ScopeProvider");
  }
  return scope.activeWriteScopeId;
}

/**
 * Returns the full scope info (id + display name + stack + active write
 * target). Must be used inside a ScopeProvider.
 */
export function useScopeInfo(): ScopeInfo {
  const scope = React.useContext(ScopeContext);
  if (scope === null) {
    throw new Error("useScopeInfo must be used inside a ScopeProvider");
  }
  return scope;
}

/**
 * Returns the full innermost-first scope stack. Use this for storage-target
 * selectors that need to expose every legal write target ("Only me here",
 * "Everyone here", "Only me org-wide", "Everyone org-wide").
 */
export function useScopeStack(): readonly ScopeStackEntry[] {
  return useScopeInfo().stack;
}

/**
 * Returns the innermost (most personal) scope id — `user_workspace_<u>_<w>`
 * in workspace context, `user_org_<u>_<o>` in global. Use this for resources
 * that are always personal-only (e.g. some OAuth tokens, per-user
 * preferences).
 */
export function useUserScope(): ScopeId {
  const stack = useScopeStack();
  const innermost = stack[0];
  if (!innermost) {
    throw new Error("useUserScope requires a non-empty scope stack");
  }
  return innermost.id;
}
