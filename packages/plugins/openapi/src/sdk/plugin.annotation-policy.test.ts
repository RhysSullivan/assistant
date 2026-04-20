import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  createExecutor,
  definePlugin,
  makeTestConfig,
  type SecretProvider,
} from "@executor/sdk";

import { annotationsForOperation } from "./invoke";
import { AnnotationPolicy } from "./types";
import { openApiPlugin } from "./plugin";

const TEST_SCOPE = "test-scope";

// ---------------------------------------------------------------------------
// Plain OpenAPI spec with GET / POST / DELETE operations so we can observe
// how per-source annotation policy overrides interact with each HTTP method.
// Hand-rolled JSON rather than Effect's HttpApi so the test stays fast and
// doesn't need a running server — we only look at tool annotations on
// executor.tools.list(), no invocations required.
// ---------------------------------------------------------------------------

const specJson = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Annotation Policy Test API", version: "1.0.0" },
  paths: {
    "/items": {
      get: {
        operationId: "listItems",
        responses: { "200": { description: "ok" } },
      },
      post: {
        operationId: "createItem",
        responses: { "200": { description: "ok" } },
      },
    },
    "/items/{id}": {
      delete: {
        operationId: "deleteItem",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
  },
});

const memoryProvider: SecretProvider = (() => {
  const store = new Map<string, string>();
  return {
    key: "memory",
    writable: true,
    get: (id, scope) =>
      Effect.sync(() => store.get(`${scope}\u0000${id}`) ?? null),
    set: (id, value, scope) =>
      Effect.sync(() => {
        store.set(`${scope}\u0000${id}`, value);
      }),
    delete: (id, scope) =>
      Effect.sync(() => store.delete(`${scope}\u0000${id}`)),
    list: () =>
      Effect.sync(() =>
        Array.from(store.keys()).map((k) => {
          const name = k.split("\u0000", 2)[1] ?? k;
          return { id: name, name };
        }),
      ),
  };
})();

const memorySecretsPlugin = definePlugin(() => ({
  id: "memory-secrets" as const,
  storage: () => ({}),
  secretProviders: [memoryProvider],
}));

// ---------------------------------------------------------------------------
// Pure unit tests for annotationsForOperation — no executor needed.
// ---------------------------------------------------------------------------

describe("annotationsForOperation", () => {
  it("applies defaults: GET is fine, POST requires approval", () => {
    expect(annotationsForOperation("get", "/items")).toEqual({});
    expect(annotationsForOperation("post", "/items")).toEqual({
      requiresApproval: true,
      approvalDescription: "POST /items",
    });
    expect(annotationsForOperation("delete", "/items/{id}")).toEqual({
      requiresApproval: true,
      approvalDescription: "DELETE /items/{id}",
    });
  });

  it("override replaces default set wholesale — GET now requires, DELETE does not", () => {
    const policy = { requireApprovalFor: ["get", "post"] as const };
    expect(annotationsForOperation("get", "/items", policy)).toEqual({
      requiresApproval: true,
      approvalDescription: "GET /items",
    });
    expect(annotationsForOperation("post", "/items", policy)).toEqual({
      requiresApproval: true,
      approvalDescription: "POST /items",
    });
    // DELETE is NOT in the list → does not require approval anymore.
    expect(annotationsForOperation("delete", "/items/{id}", policy)).toEqual({});
  });

  it("empty list means nothing requires approval", () => {
    const policy = { requireApprovalFor: [] as readonly string[] };
    expect(annotationsForOperation("get", "/items", policy)).toEqual({});
    expect(annotationsForOperation("post", "/items", policy)).toEqual({});
    expect(annotationsForOperation("delete", "/items/{id}", policy)).toEqual({});
  });

  it("policy with undefined requireApprovalFor falls back to defaults", () => {
    const policy = {} as { requireApprovalFor?: readonly string[] };
    expect(annotationsForOperation("get", "/items", policy)).toEqual({});
    expect(annotationsForOperation("post", "/items", policy)).toEqual({
      requiresApproval: true,
      approvalDescription: "POST /items",
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests through the full executor.openapi.addSpec /
// updateSource / tools.list path.
// ---------------------------------------------------------------------------

const makeExecutor = () =>
  createExecutor(
    makeTestConfig({
      plugins: [openApiPlugin(), memorySecretsPlugin()] as const,
    }),
  );

const findTool = (
  tools: readonly { readonly id: string }[],
  id: string,
): (typeof tools)[number] | undefined => tools.find((t) => t.id === id);

describe("openapi per-source annotation policy", () => {
  it.effect("default policy: GET ok, POST requires approval", () =>
    Effect.gen(function* () {
      const executor = yield* makeExecutor();

      yield* executor.openapi.addSpec({
        spec: specJson,
        scope: TEST_SCOPE,
        namespace: "defaults",
        baseUrl: "",
      });

      const tools = yield* executor.tools.list();
      const listTool = findTool(tools, "defaults.items.listItems") as
        | { annotations?: { requiresApproval?: boolean } }
        | undefined;
      const createTool = findTool(tools, "defaults.items.createItem") as
        | {
            annotations?: {
              requiresApproval?: boolean;
              approvalDescription?: string;
            };
          }
        | undefined;

      expect(listTool).toBeDefined();
      expect(createTool).toBeDefined();
      expect(listTool!.annotations?.requiresApproval).toBeFalsy();
      expect(createTool!.annotations?.requiresApproval).toBe(true);
      expect(createTool!.annotations?.approvalDescription).toBe("POST /items");
    }),
  );

  it.effect(
    "override requireApprovalFor=[get,post]: GET now approves, DELETE does not",
    () =>
      Effect.gen(function* () {
        const executor = yield* makeExecutor();

        yield* executor.openapi.addSpec({
          spec: specJson,
          scope: TEST_SCOPE,
          namespace: "override",
          baseUrl: "",
          annotationPolicy: new AnnotationPolicy({
            requireApprovalFor: ["get", "post"],
          }),
        });

        const tools = yield* executor.tools.list();
        const listTool = findTool(tools, "override.items.listItems") as
          | {
              annotations?: {
                requiresApproval?: boolean;
                approvalDescription?: string;
              };
            }
          | undefined;
        const deleteTool = findTool(tools, "override.items.deleteItem") as
          | { annotations?: { requiresApproval?: boolean } }
          | undefined;

        expect(listTool?.annotations?.requiresApproval).toBe(true);
        expect(listTool?.annotations?.approvalDescription).toBe("GET /items");
        expect(deleteTool?.annotations?.requiresApproval).toBeFalsy();
      }),
  );

  it.effect("empty requireApprovalFor: nothing requires approval", () =>
    Effect.gen(function* () {
      const executor = yield* makeExecutor();

      yield* executor.openapi.addSpec({
        spec: specJson,
        scope: TEST_SCOPE,
        namespace: "permissive",
        baseUrl: "",
        annotationPolicy: new AnnotationPolicy({ requireApprovalFor: [] }),
      });

      const tools = yield* executor.tools.list();
      const createTool = findTool(tools, "permissive.items.createItem") as
        | { annotations?: { requiresApproval?: boolean } }
        | undefined;
      const deleteTool = findTool(tools, "permissive.items.deleteItem") as
        | { annotations?: { requiresApproval?: boolean } }
        | undefined;

      expect(createTool?.annotations?.requiresApproval).toBeFalsy();
      expect(deleteTool?.annotations?.requiresApproval).toBeFalsy();
    }),
  );

  it.effect("updateSource(null) clears override -> defaults return", () =>
    Effect.gen(function* () {
      const executor = yield* makeExecutor();

      yield* executor.openapi.addSpec({
        spec: specJson,
        scope: TEST_SCOPE,
        namespace: "togglable",
        baseUrl: "",
        annotationPolicy: new AnnotationPolicy({ requireApprovalFor: [] }),
      });

      // Before clear: POST should NOT require approval (empty list wins).
      const before = yield* executor.tools.list();
      const createBefore = findTool(before, "togglable.items.createItem") as
        | { annotations?: { requiresApproval?: boolean } }
        | undefined;
      expect(createBefore?.annotations?.requiresApproval).toBeFalsy();

      yield* executor.openapi.updateSource("togglable", TEST_SCOPE, {
        annotationPolicy: null,
      });

      // Sanity — the stored source should no longer carry a policy.
      const clearedSource = yield* executor.openapi.getSource("togglable", TEST_SCOPE);
      expect(clearedSource?.config.annotationPolicy).toBeUndefined();

      // After clear: back to defaults — POST requires approval again.
      const after = yield* executor.tools.list();
      const createAfter = findTool(after, "togglable.items.createItem") as
        | { annotations?: { requiresApproval?: boolean } }
        | undefined;
      const listAfter = findTool(after, "togglable.items.listItems") as
        | { annotations?: { requiresApproval?: boolean } }
        | undefined;
      expect(createAfter?.annotations?.requiresApproval).toBe(true);
      expect(listAfter?.annotations?.requiresApproval).toBeFalsy();
    }),
  );

  it.effect(
    "updateSource with undefined annotationPolicy leaves existing override intact",
    () =>
      Effect.gen(function* () {
        const executor = yield* makeExecutor();

        yield* executor.openapi.addSpec({
          spec: specJson,
          scope: TEST_SCOPE,
          namespace: "sticky",
          baseUrl: "",
          annotationPolicy: new AnnotationPolicy({
            requireApprovalFor: ["get"],
          }),
        });

        // Name-only update — no annotationPolicy key means "leave as-is".
        yield* executor.openapi.updateSource("sticky", TEST_SCOPE, { name: "Renamed" });

        const tools = yield* executor.tools.list();
        const listTool = findTool(tools, "sticky.items.listItems") as
          | { annotations?: { requiresApproval?: boolean } }
          | undefined;
        const createTool = findTool(tools, "sticky.items.createItem") as
          | { annotations?: { requiresApproval?: boolean } }
          | undefined;

        // Override still active: GET requires approval, POST does not.
        expect(listTool?.annotations?.requiresApproval).toBe(true);
        expect(createTool?.annotations?.requiresApproval).toBeFalsy();

        // And the name actually changed — sanity check that updateSource ran.
        const source = yield* executor.openapi.getSource("sticky", TEST_SCOPE);
        expect(source?.name).toBe("Renamed");
      }),
  );
});
