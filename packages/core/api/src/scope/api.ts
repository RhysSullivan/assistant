import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Schema } from "effect";
import { ScopeId } from "@executor-js/sdk";

import { InternalError } from "../observability";

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

// `id` / `name` / `dir` track the active display/write scope for the current
// URL context — `org_<orgId>` in global, `workspace_<workspaceId>` in
// workspace contexts. Source-definition writes default to this scope; secret
// / connection / policy writes can target any entry in `stack` and the
// caller picks via `activeWriteScopeId` or another scope from the stack.
//
// `stack` is the full executor scope stack, innermost first. UIs use it to
// render storage-target selectors ("Only me in this workspace" → user-
// workspace, "Everyone in this workspace" → workspace, etc.) and to label
// inherited resources by scope.
//
// `activeWriteScopeId` is the default write target — `org` in global, `workspace`
// in workspace contexts. Pre-computed by the server so the UI doesn't have to
// re-derive the "skip user-prefixed scopes" rule.
const ScopeInfoResponse = Schema.Struct({
  id: ScopeId,
  name: Schema.String,
  dir: Schema.String,
  activeWriteScopeId: ScopeId,
  stack: Schema.Array(
    Schema.Struct({
      id: ScopeId,
      name: Schema.String,
      dir: Schema.String,
    }),
  ),
});

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export const ScopeApi = HttpApiGroup.make("scope").add(
  HttpApiEndpoint.get("info", "/scope", {
    success: ScopeInfoResponse,
    error: InternalError,
  }),
);
