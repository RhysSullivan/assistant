import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect } from "effect";

import { ExecutorApi } from "../api";
import { ExecutorService } from "../services";
import { capture } from "@executor-js/api";
import { ScopeId } from "@executor-js/sdk";

// Compute the active source-definition write scope from the executor's
// innermost-first scope stack.
//
//   global stack:    [user_org_<u>_<o>, org_<o>]                              -> org_<o>
//   workspace stack: [user_workspace_<u>_<w>, workspace_<w>,
//                     user_org_<u>_<o>, org_<o>]                              -> workspace_<w>
//
// The rule: skip personal scopes (those whose id starts with `user_`); the
// first non-personal scope from the inner end is the active write target.
// `cloud-workspaces-08` introduced these prefixes via `apps/cloud/src/services/ids.ts`,
// so any deployment running this code already produces them. Local dev with a
// pre-prefix `org_<id>` is unaffected — that id has no `user_` prefix and gets
// picked first either way.
const isUserScope = (id: string): boolean =>
  id.startsWith("user_org_") || id.startsWith("user_workspace_");

const computeActiveWriteScopeId = (
  scopes: ReadonlyArray<{ readonly id: ScopeId }>,
): ScopeId => {
  for (const scope of scopes) {
    if (!isUserScope(scope.id)) {
      return scope.id;
    }
  }
  // Stack is all-personal — fall back to the innermost. Should not happen in
  // production (cloud always seeds an org scope), but the type system lets
  // callers configure any stack and we don't want a partial response.
  const fallback = scopes[0];
  if (!fallback) {
    throw new Error("scope.info called with empty executor scope stack");
  }
  return fallback.id;
};

export const ScopeHandlers = HttpApiBuilder.group(ExecutorApi, "scope", (handlers) =>
  handlers.handle("info", () =>
    capture(Effect.gen(function* () {
      const executor = yield* ExecutorService;
      const stack = executor.scopes;
      // Active scope drives the UI's default display + source-definition
      // writes; stack drives storage-target selectors. See the schema in
      // `../scope/api.ts` for the full contract.
      const activeWriteScopeId = computeActiveWriteScopeId(stack);
      const active =
        stack.find((s) => s.id === activeWriteScopeId) ?? stack.at(-1)!;
      return {
        id: active.id,
        name: active.name,
        dir: active.name,
        activeWriteScopeId,
        stack: stack.map((entry) => ({
          id: entry.id,
          name: entry.name,
          dir: entry.name,
        })),
      };
    })),
  ),
);
