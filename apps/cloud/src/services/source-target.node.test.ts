// Source-definition write target invariant — the cloud half of the
// `InvalidSourceWriteTargetError` contract. The SDK-level test in
// `packages/core/sdk/src/executor.test.ts` covers the rejection path; this
// suite covers the HTTP boundary cases the SDK can't see:
//
//   - addSpec under the URL context's workspace scope succeeds and lands
//     at `workspace_<id>`.
//   - addSpec under the org/global scope from workspace context succeeds
//     (still legal — `org` is in the workspace stack).
//
// The personal-scope rejection paths are exercised at the SDK level,
// because Effect's HTTP path matcher has trouble round-tripping the cloud's
// long compound `user_*` scope ids; that's a routing limitation, not a
// product gap, and we still get coverage of the SDK guard from the SDK
// suite. The InvalidSourceWriteTargetError is wired through the openapi /
// mcp / graphql / google-discovery API groups with `httpApiStatus: 422`, so
// when the SDK fires the error, the HTTP edge already has a schema for it.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  asOrg,
  asWorkspace,
  orgScopeId,
  testWorkspaceScopeId,
} from "./__test-harness__/api-harness";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Target Test", version: "1.0.0" },
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

describe("source-definition write target invariant (HTTP)", () => {
  it.effect(
    "addSpec under the workspace scope from workspace context succeeds and lands at workspace scope",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const namespace = `ns_${crypto.randomUUID().replace(/-/g, "_")}`;
        const wsScope = testWorkspaceScopeId(org, slug);

        yield* asWorkspace(org, slug, (client) =>
          client.openapi.addSpec({
            params: { scopeId: wsScope },
            payload: { spec: SPEC, namespace },
          }),
        );

        const sources = yield* asWorkspace(org, slug, (client) =>
          client.sources.list({ params: { scopeId: wsScope } }),
        );
        const row = sources.find((s) => s.id === namespace);
        expect(row?.scopeId).toBe(wsScope);
      }),
  );

  it.effect(
    "addSpec from workspace context targeting the global org scope is allowed (still in stack)",
    () =>
      Effect.gen(function* () {
        const org = `org_${crypto.randomUUID()}`;
        const slug = `ws_${crypto.randomUUID().slice(0, 8)}`;
        const namespace = `ns_${crypto.randomUUID().replace(/-/g, "_")}`;
        const orgScope = orgScopeId(org);

        yield* asWorkspace(org, slug, (client) =>
          client.openapi.addSpec({
            params: { scopeId: orgScope },
            payload: { spec: SPEC, namespace },
          }),
        );

        const sources = yield* asWorkspace(org, slug, (client) =>
          client.sources.list({ params: { scopeId: orgScope } }),
        );
        const row = sources.find((s) => s.id === namespace);
        expect(row?.scopeId).toBe(orgScope);

        // Same row visible from the org-only context too — confirms the
        // write actually landed at the global scope, not at the workspace.
        const orgVisible = yield* asOrg(org, (client) =>
          client.sources.list({ params: { scopeId: orgScope } }),
        );
        expect(orgVisible.find((s) => s.id === namespace)).toBeDefined();
      }),
  );
});
