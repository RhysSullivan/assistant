// Workspace-prefixed API requests — verify that hitting
// `/api/${orgId}/${workspaceSlug}/...` builds an executor whose scope stack
// is the workspace stack (not the org-only stack), and that the same
// `ProtectedCloudApi` schema serves both prefixes.
//
// In v1 there are no workspace ACLs — org membership is the only check —
// so the test only needs to exercise that the URL truly drives scope stack
// construction. Adding a source under the workspace scope and listing it
// from both contexts pins down the executor wiring.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  asOrg,
  asWorkspace,
  orgScopeId,
  testWorkspaceScopeId,
} from "./__test-harness__/api-harness";

const MINIMAL_OPENAPI_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Workspace Test API", version: "1.0.0" },
  paths: {
    "/ping": {
      get: {
        operationId: "ping",
        summary: "ping",
        responses: { "200": { description: "ok" } },
      },
    },
  },
});

describe("workspace-prefixed protected API", () => {
  it.effect(
    "addSpec at the workspace scope id is visible from workspace context but not from org global",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const namespace = `ns_${crypto.randomUUID().replace(/-/g, "_")}`;
        const wsScope = testWorkspaceScopeId(org, slug);

        // Write under the workspace scope. The middleware sees the
        // `/api/${org}/${slug}/...` prefix, resolves the workspace, and
        // builds `[user_workspace, workspace, user_org, org]`. Listing
        // workspace sources should include the new namespace because the
        // executor walks that stack on read.
        yield* asWorkspace(org, slug, (client) =>
          client.openapi.addSpec({
            params: { scopeId: wsScope },
            payload: { spec: MINIMAL_OPENAPI_SPEC, namespace },
          }),
        );

        const wsSources = yield* asWorkspace(org, slug, (client) =>
          client.sources.list({ params: { scopeId: wsScope } }),
        );
        expect(wsSources.map((s) => s.id)).toContain(namespace);

        // From global org context the executor stack is just
        // `[user_org, org]` — the workspace-scoped row should be invisible.
        const orgSources = yield* asOrg(org, (client) =>
          client.sources.list({ params: { scopeId: orgScopeId(org) } }),
        );
        expect(orgSources.map((s) => s.id)).not.toContain(namespace);
      }),
  );

  it.effect("workspace context inherits global sources via the scope stack", () =>
    Effect.gen(function* () {
      const org = `org_${crypto.randomUUID()}`;
      const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
      const namespace = `ns_${crypto.randomUUID().replace(/-/g, "_")}`;

      // Add a source under the org/global scope...
      yield* asOrg(org, (client) =>
        client.openapi.addSpec({
          params: { scopeId: orgScopeId(org) },
          payload: { spec: MINIMAL_OPENAPI_SPEC, namespace },
        }),
      );

      // ...and read it from inside a workspace context. The workspace stack
      // ends in `org_<orgId>`, so the inherited source must show up.
      const sources = yield* asWorkspace(org, slug, (client) =>
        client.sources.list({ params: { scopeId: orgScopeId(org) } }),
      );
      expect(sources.map((s) => s.id)).toContain(namespace);
    }),
  );
});
