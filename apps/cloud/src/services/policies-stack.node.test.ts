// Policies storage-stack invariants — verifies that policy writes accept
// any scope in the workspace stack (`user-workspace → workspace →
// user-org → org`) and that listing from workspace context returns every
// row sorted innermost-first. Pins the SDK precedence rule used by tool
// invocation: the innermost row wins.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  asWorkspaceUser,
  orgScopeId,
  testUserOrgScopeId,
  testUserWorkspaceScopeId,
  testWorkspaceScopeId,
} from "./__test-harness__/api-harness";

const PATTERN = "*"; // every tool

describe("policies storage stack in workspace context", () => {
  it.effect(
    "policies write at every scope level in the URL-resolved stack",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const userId = `u_${crypto.randomUUID().slice(0, 8)}`;
        const wsScope = testWorkspaceScopeId(org, slug);
        const orgScope = orgScopeId(org);
        const userOrg = testUserOrgScopeId(userId, org);
        const userWs = testUserWorkspaceScopeId(userId, org, slug);

        // Each level gets a distinct action so the listing can match
        // rows back to their scopes deterministically.
        yield* asWorkspaceUser(userId, org, slug, (client) =>
          Effect.gen(function* () {
            yield* client.policies.create({
              params: { scopeId: userWs },
              payload: { pattern: PATTERN, action: "block" },
            });
            yield* client.policies.create({
              params: { scopeId: wsScope },
              payload: { pattern: PATTERN, action: "require_approval" },
            });
            yield* client.policies.create({
              params: { scopeId: userOrg },
              payload: { pattern: PATTERN, action: "approve" },
            });
            yield* client.policies.create({
              params: { scopeId: orgScope },
              payload: { pattern: PATTERN, action: "require_approval" },
            });
          }),
        );

        // Listing from workspace context returns every row, each tagged
        // with its owning scope id.
        const list = yield* asWorkspaceUser(userId, org, slug, (client) =>
          client.policies.list({ params: { scopeId: wsScope } }),
        );
        const byScope = new Map(list.map((p) => [p.scopeId, p.action]));
        expect(byScope.get(userWs)).toBe("block");
        expect(byScope.get(wsScope)).toBe("require_approval");
        expect(byScope.get(userOrg)).toBe("approve");
        expect(byScope.get(orgScope)).toBe("require_approval");

        // Sort order: innermost-first. The user-workspace row lands at
        // index 0, the org row at index N-1.
        const innermost = list[0];
        const outermost = list[list.length - 1];
        expect(innermost?.scopeId).toBe(userWs);
        expect(outermost?.scopeId).toBe(orgScope);
      }),
  );

  it.effect(
    "innermost matching policy wins — user-workspace beats workspace beats org",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const userId = `u_${crypto.randomUUID().slice(0, 8)}`;
        const wsScope = testWorkspaceScopeId(org, slug);
        const orgScope = orgScopeId(org);
        const userWs = testUserWorkspaceScopeId(userId, org, slug);

        // Three same-pattern rows with different actions across the
        // stack. The SDK's `resolveToolPolicy` (in
        // `packages/core/sdk/src/policies.ts`) ranks by `scope_id` →
        // `position` and picks the innermost match.
        yield* asWorkspaceUser(userId, org, slug, (client) =>
          Effect.gen(function* () {
            yield* client.policies.create({
              params: { scopeId: orgScope },
              payload: { pattern: PATTERN, action: "block" },
            });
            yield* client.policies.create({
              params: { scopeId: wsScope },
              payload: { pattern: PATTERN, action: "require_approval" },
            });
            yield* client.policies.create({
              params: { scopeId: userWs },
              payload: { pattern: PATTERN, action: "approve" },
            });
          }),
        );

        // Listing returns all 3, but the innermost is at position 0.
        // That ordering is what `resolveToolPolicy` consumes when the
        // executor looks up the effective policy for a tool id.
        const list = yield* asWorkspaceUser(userId, org, slug, (client) =>
          client.policies.list({ params: { scopeId: wsScope } }),
        );
        const policies = list.filter((p) => p.pattern === PATTERN);
        expect(policies).toHaveLength(3);
        expect(policies[0]?.scopeId).toBe(userWs);
        expect(policies[0]?.action).toBe("approve");
      }),
  );
});
