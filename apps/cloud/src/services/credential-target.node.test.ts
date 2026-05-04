// Credential write-target invariants — secrets and connections accept any
// scope in the URL context's stack (4 levels in workspace context, 2 in
// global), and reject scopes outside the stack with a typed storage
// failure. Mirrors `secrets-isolation.e2e.node.test.ts` for cross-org
// rejections, but exercises the full personal/shared cross product within
// a single workspace context.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { SecretId } from "@executor-js/sdk";

import {
  asWorkspace,
  asWorkspaceUser,
  orgScopeId,
  testUserOrgScopeId,
  testUserWorkspaceScopeId,
  testWorkspaceScopeId,
} from "./__test-harness__/api-harness";

const setSecret = (
  client: Parameters<Parameters<typeof asWorkspace>[2]>[0],
  scopeId: string,
  id: string,
  value: string,
) =>
  client.secrets.set({
    params: { scopeId: scopeId as never },
    payload: {
      id: SecretId.make(id),
      name: id,
      value,
    },
  });

describe("credential write targets in workspace context", () => {
  it.effect(
    "secrets land at every scope in the URL-resolved stack and list back tagged with that scope",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const userId = `u_${crypto.randomUUID().slice(0, 8)}`;
        const wsScope = testWorkspaceScopeId(org, slug);
        const orgScope = orgScopeId(org);
        const userOrg = testUserOrgScopeId(userId, org);
        const userWs = testUserWorkspaceScopeId(userId, org, slug);

        // One secret per scope, distinct ids so they don't dedup.
        yield* asWorkspaceUser(userId, org, slug, (client) =>
          Effect.gen(function* () {
            yield* setSecret(client, userWs, "uws", "uws-val");
            yield* setSecret(client, wsScope, "ws", "ws-val");
            yield* setSecret(client, userOrg, "uorg", "uorg-val");
            yield* setSecret(client, orgScope, "org", "org-val");
          }),
        );

        // Listing from the workspace scope walks the full stack — all 4
        // secrets show up, each tagged with its owning scope.
        const list = yield* asWorkspaceUser(userId, org, slug, (client) =>
          client.secrets.list({ params: { scopeId: wsScope } }),
        );
        const byId = new Map(list.map((r) => [r.id, r.scopeId]));
        expect(byId.get(SecretId.make("uws"))).toBe(userWs);
        expect(byId.get(SecretId.make("ws"))).toBe(wsScope);
        expect(byId.get(SecretId.make("uorg"))).toBe(userOrg);
        expect(byId.get(SecretId.make("org"))).toBe(orgScope);
      }),
  );

  it.effect(
    "secret writes targeting an out-of-stack scope are rejected",
    () =>
      Effect.gen(function* () {
        const orgA = `org_${crypto.randomUUID()}`;
        const orgB = `org_${crypto.randomUUID()}`;
        const slugA = `ws_${crypto.randomUUID().slice(0, 8)}`;

        // From workspace context for orgA, try to write a secret
        // targeting orgB's scope. The scoped adapter rejects writes whose
        // `scope_id` isn't in the executor's stack — the cloud's
        // `secrets-isolation.e2e.node.test.ts` covers the org boundary;
        // this case adds the workspace-context wrapper for parity.
        const exit = yield* Effect.exit(
          asWorkspace(orgA, slugA, (client) =>
            setSecret(client, orgScopeId(orgB), "leak", "v"),
          ),
        );
        expect(exit._tag).toBe("Failure");
      }),
  );
});
