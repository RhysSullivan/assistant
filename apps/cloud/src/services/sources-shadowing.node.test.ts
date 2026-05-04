// Workspace + global source listing — verifies that when a workspace source
// shadows a global source by namespace, both rows show up in
// `sources.list` from workspace context, the inner workspace row has no
// `overriddenBy`, and the outer global row carries the workspace scope id
// in its `overriddenBy` field. The cloud sidebar renders the latter as a
// muted `Overridden` entry; see `apps/cloud/src/web/shell.tsx#SourceList`.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  asOrg,
  asWorkspace,
  orgScopeId,
  testWorkspaceScopeId,
} from "./__test-harness__/api-harness";

const SHADOW_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Shadow API", version: "1.0.0" },
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

describe("sources.list with workspace + global shadowing", () => {
  it.effect(
    "returns both rows with scopeId + overriddenBy when workspace shadows a global namespace",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const namespace = `ns_${crypto.randomUUID().replace(/-/g, "_")}`;
        const orgScope = orgScopeId(org);
        const wsScope = testWorkspaceScopeId(org, slug);

        // Add a global source first.
        yield* asOrg(org, (client) =>
          client.openapi.addSpec({
            params: { scopeId: orgScope },
            payload: { spec: SHADOW_SPEC, namespace },
          }),
        );

        // Then add a workspace source under the same namespace, which
        // shadows the global one in this workspace.
        yield* asWorkspace(org, slug, (client) =>
          client.openapi.addSpec({
            params: { scopeId: wsScope },
            payload: { spec: SHADOW_SPEC, namespace },
          }),
        );

        // Listing from workspace context — both rows should be returned,
        // with the outer global row marked `overriddenBy: <workspaceScope>`.
        const wsSources = yield* asWorkspace(org, slug, (client) =>
          client.sources.list({ params: { scopeId: wsScope } }),
        );
        const matches = wsSources.filter((s) => s.id === namespace);
        expect(matches).toHaveLength(2);

        const effective = matches.find((s) => s.overriddenBy === undefined);
        const shadowed = matches.find((s) => s.overriddenBy !== undefined);
        expect(effective).toBeDefined();
        expect(shadowed).toBeDefined();
        expect(effective!.scopeId).toBe(wsScope);
        expect(shadowed!.scopeId).toBe(orgScope);
        expect(shadowed!.overriddenBy).toBe(wsScope);

        // Listing from global context — only the global row, no override.
        const orgSources = yield* asOrg(org, (client) =>
          client.sources.list({ params: { scopeId: orgScope } }),
        );
        const orgMatches = orgSources.filter((s) => s.id === namespace);
        expect(orgMatches).toHaveLength(1);
        expect(orgMatches[0]!.scopeId).toBe(orgScope);
        expect(orgMatches[0]!.overriddenBy).toBeUndefined();
      }),
  );

  it.effect(
    "non-shadowing workspace + global namespaces both appear without override flags",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const wsNamespace = `ws_only_${crypto.randomUUID().replace(/-/g, "_")}`;
        const orgNamespace = `org_only_${crypto.randomUUID().replace(/-/g, "_")}`;
        const orgScope = orgScopeId(org);
        const wsScope = testWorkspaceScopeId(org, slug);

        yield* asOrg(org, (client) =>
          client.openapi.addSpec({
            params: { scopeId: orgScope },
            payload: { spec: SHADOW_SPEC, namespace: orgNamespace },
          }),
        );
        yield* asWorkspace(org, slug, (client) =>
          client.openapi.addSpec({
            params: { scopeId: wsScope },
            payload: { spec: SHADOW_SPEC, namespace: wsNamespace },
          }),
        );

        const wsSources = yield* asWorkspace(org, slug, (client) =>
          client.sources.list({ params: { scopeId: wsScope } }),
        );

        const wsRow = wsSources.find((s) => s.id === wsNamespace);
        const orgRow = wsSources.find((s) => s.id === orgNamespace);
        expect(wsRow).toBeDefined();
        expect(orgRow).toBeDefined();
        expect(wsRow!.scopeId).toBe(wsScope);
        expect(orgRow!.scopeId).toBe(orgScope);
        expect(wsRow!.overriddenBy).toBeUndefined();
        expect(orgRow!.overriddenBy).toBeUndefined();
      }),
  );
});
