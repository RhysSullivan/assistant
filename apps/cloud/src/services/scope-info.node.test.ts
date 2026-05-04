// Scope info handler — verifies that `/scope` returns the active write scope
// id alongside the full scope stack for both global (`/api/:org`) and
// workspace (`/api/:org/:workspace`) URL contexts.
//
// The plan in `notes/cloud-workspaces-and-global-sources-plan.md` ("Executor
// Construction") calls for the API to expose:
//
//   - `id` — active display scope (org in global, workspace in workspace).
//   - `activeWriteScopeId` — explicit default source-definition write target.
//   - `stack` — the full innermost-first stack so the UI can render storage-
//     target selectors (user-workspace, workspace, user-org, org).
//
// The handler computes `activeWriteScopeId` by skipping personal scopes
// (`user_*`); the first non-personal scope from the inner end is the active
// target. These tests pin that rule by asserting concrete ids built with the
// same helpers the executor factory uses.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  asOrg,
  asWorkspace,
  orgScopeId,
  testWorkspaceScopeId,
} from "./__test-harness__/api-harness";

describe("scope.info", () => {
  it.effect("global context returns activeWriteScope = org_<id>", () =>
    Effect.gen(function* () {
      const org = `org_${crypto.randomUUID()}`;

      const info = yield* asOrg(org, (client) => client.scope.info());

      expect(info.activeWriteScopeId).toBe(orgScopeId(org));
      expect(info.id).toBe(orgScopeId(org));
      // Stack is innermost-first: [user_org, org].
      expect(info.stack).toHaveLength(2);
      expect(info.stack[0]!.id).toMatch(/^user_org_/);
      expect(info.stack[1]!.id).toBe(orgScopeId(org));
    }),
  );

  it.effect("workspace context returns activeWriteScope = workspace_<id>", () =>
    Effect.gen(function* () {
      const org = `org_${crypto.randomUUID()}`;
      const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;

      const info = yield* asWorkspace(org, slug, (client) => client.scope.info());

      expect(info.activeWriteScopeId).toBe(testWorkspaceScopeId(org, slug));
      expect(info.id).toBe(testWorkspaceScopeId(org, slug));
      // Stack is innermost-first: [user_workspace, workspace, user_org, org].
      expect(info.stack).toHaveLength(4);
      expect(info.stack[0]!.id).toMatch(/^user_workspace_/);
      expect(info.stack[1]!.id).toBe(testWorkspaceScopeId(org, slug));
      expect(info.stack[2]!.id).toMatch(/^user_org_/);
      expect(info.stack[3]!.id).toBe(orgScopeId(org));
    }),
  );
});
