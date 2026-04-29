import {
  PolicyId,
  type ScopeId,
  type ToolId,
  type SecretId,
  type ToolPolicyAction,
} from "@executor/sdk";
import { Atom, Result } from "@effect-atom/atom-react";

import { ExecutorApiClient } from "./client";
import { ReactivityKey } from "./reactivity-keys";

// ---------------------------------------------------------------------------
// Scope — fetched from the server
// ---------------------------------------------------------------------------

export const scopeAtom = ExecutorApiClient.query("scope", "info", {
  timeToLive: "5 minutes",
  reactivityKeys: [ReactivityKey.scope],
});

// ---------------------------------------------------------------------------
// Query atoms — typed, cached, reactive
// ---------------------------------------------------------------------------

export const toolsAtom = (scopeId: ScopeId) =>
  ExecutorApiClient.query("tools", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
    reactivityKeys: [ReactivityKey.tools],
  });

/** Tools for a specific source */
export const sourceToolsAtom = (sourceId: string, scopeId: ScopeId) =>
  ExecutorApiClient.query("sources", "tools", {
    path: { scopeId, sourceId },
    timeToLive: "30 seconds",
    reactivityKeys: [ReactivityKey.tools],
  });

export const toolSchemaAtom = (scopeId: ScopeId, toolId: ToolId) =>
  ExecutorApiClient.query("tools", "schema", {
    path: { scopeId, toolId },
    timeToLive: "1 minute",
    reactivityKeys: [ReactivityKey.tools],
  });

export const sourcesAtom = (scopeId: ScopeId) =>
  ExecutorApiClient.query("sources", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
    reactivityKeys: [ReactivityKey.sources],
  });

/** Single source by id — derived from the sources list */
export const sourceAtom = (sourceId: string, scopeId: ScopeId) =>
  Atom.mapResult(sourcesAtom(scopeId), (sources) => sources.find((s) => s.id === sourceId) ?? null);

export const secretsAtom = (scopeId: ScopeId) =>
  ExecutorApiClient.query("secrets", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
    reactivityKeys: [ReactivityKey.secrets],
  });

export const secretStatusAtom = (scopeId: ScopeId, secretId: SecretId) =>
  ExecutorApiClient.query("secrets", "status", {
    path: { scopeId, secretId },
    timeToLive: "15 seconds",
    reactivityKeys: [ReactivityKey.secrets],
  });

export const connectionsAtom = (scopeId: ScopeId) =>
  ExecutorApiClient.query("connections", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
    reactivityKeys: [ReactivityKey.connections],
  });

export const policiesAtom = (scopeId: ScopeId) =>
  ExecutorApiClient.query("policies", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
    reactivityKeys: [ReactivityKey.policies],
  });

// ---------------------------------------------------------------------------
// Mutation atoms — reactivityKeys must be passed at call site (effect-atom
// does not accept them at definition time). See `reactivity-keys.tsx` for the
// canonical key arrays.
// ---------------------------------------------------------------------------

export const setSecret = ExecutorApiClient.mutation("secrets", "set");

export const removeSecret = ExecutorApiClient.mutation("secrets", "remove");

export const removeConnection = ExecutorApiClient.mutation(
  "connections",
  "remove",
);

export const removeSource = ExecutorApiClient.mutation("sources", "remove");

export const refreshSource = ExecutorApiClient.mutation("sources", "refresh");

export const detectSource = ExecutorApiClient.mutation("sources", "detect");

export const createPolicy = ExecutorApiClient.mutation("policies", "create");

export const updatePolicy = ExecutorApiClient.mutation("policies", "update");

export const removePolicy = ExecutorApiClient.mutation("policies", "remove");

// ---------------------------------------------------------------------------
// Policies — optimistic surface. Reads go through `policiesOptimisticAtom`
// (which layers in-flight transitions on top of `policiesAtom`), and writes
// go through the matching `*PolicyOptimistic` mutation atoms. Each mutation
// declares a reducer that produces the next array of rows; effect-atom's
// `Atom.optimisticFn` handles transition tracking, waiting state, and the
// post-commit refresh — including racing calls (latest reducer wins).
// ---------------------------------------------------------------------------

export const policiesOptimisticAtom = Atom.family((scopeId: ScopeId) =>
  Atom.optimistic(policiesAtom(scopeId)),
);

export const createPolicyOptimistic = Atom.family((scopeId: ScopeId) =>
  policiesOptimisticAtom(scopeId).pipe(
    Atom.optimisticFn({
      reducer: (
        current,
        arg: {
          path: { scopeId: ScopeId };
          payload: {
            pattern: string;
            action: ToolPolicyAction;
            position?: string;
          };
          reactivityKeys?: ReadonlyArray<unknown>;
        },
      ) =>
        Result.map(current, (rows) => [
          {
            id: PolicyId.make(
              `pending-${Math.random().toString(36).slice(2)}`,
            ),
            scopeId,
            pattern: arg.payload.pattern,
            action: arg.payload.action,
            // Empty string sorts before any fractional-indexing key, so
            // the placeholder lands at the top until the server returns
            // the canonical key.
            position: "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ...rows,
        ]),
      fn: createPolicy,
    }),
  ),
);

export const updatePolicyOptimistic = Atom.family((_scopeId: ScopeId) =>
  policiesOptimisticAtom(_scopeId).pipe(
    Atom.optimisticFn({
      reducer: (
        current,
        arg: {
          path: { scopeId: ScopeId; policyId: PolicyId };
          payload: {
            pattern?: string;
            action?: ToolPolicyAction;
            position?: string;
          };
          reactivityKeys?: ReadonlyArray<unknown>;
        },
      ) =>
        Result.map(current, (rows) =>
          rows.map((r) =>
            r.id === arg.path.policyId
              ? {
                  ...r,
                  ...(arg.payload.action !== undefined
                    ? { action: arg.payload.action }
                    : {}),
                  ...(arg.payload.pattern !== undefined
                    ? { pattern: arg.payload.pattern }
                    : {}),
                  ...(arg.payload.position !== undefined
                    ? { position: arg.payload.position }
                    : {}),
                }
              : r,
          ),
        ),
      fn: updatePolicy,
    }),
  ),
);

export const removePolicyOptimistic = Atom.family((scopeId: ScopeId) =>
  policiesOptimisticAtom(scopeId).pipe(
    Atom.optimisticFn({
      reducer: (
        current,
        arg: {
          path: { scopeId: ScopeId; policyId: PolicyId };
          reactivityKeys?: ReadonlyArray<unknown>;
        },
      ) =>
        Result.map(current, (rows) =>
          rows.filter((r) => r.id !== arg.path.policyId),
        ),
      fn: removePolicy,
    }),
  ),
);
