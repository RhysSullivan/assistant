// ---------------------------------------------------------------------------
// End-to-end test: core-owned source/tool tables + plugin-owned
// enrichment + Pattern C override. Exercises:
//
//   1. Migrate core + plugin schemas together
//   2. createExecutor upserts static control sources into core
//   3. addSpec / addEndpoint route through ctx.core.sources.register
//      (core metadata) + ctx.storage (plugin enrichment) in one transaction
//   4. executor.sources.list() and executor.tools.list() are pure core
//      queries — no plugin scanning
//   5. executor.tools.invoke(id, args) looks up the core tool row once,
//      delegates to the owning plugin's invokeTool
//   6. Persistence across executor instances (no rehydration loop in
//      init — the core tables ARE the persistent state)
//   7. Pattern C override: custom OpenApiSpecStore skips plugin
//      enrichment writes and blob writes, but core source/tool tables
//      still get populated (different write path)
// ---------------------------------------------------------------------------

import { describe, test, expect } from "vitest";
import { Data, Effect, Exit, Cause } from "effect";
import * as SqlClient from "@effect/sql/SqlClient";
import { SqliteClient } from "@effect/sql-sqlite-node";

class SimulatedFailure extends Data.TaggedError("SimulatedFailure")<{
  readonly message: string;
}> {}

import { makeSqlAdapter, migrate } from "@executor/storage-sql";

import { makeInMemoryBlobStore } from "../blob";
import {
  PluginNotLoadedError,
  SourceRemovalNotAllowedError,
  ToolInvocationError,
  ToolNotFoundError,
} from "../errors";
import { createExecutor, collectSchemas } from "../executor";
import { keychainPlugin } from "../__fixtures__/keychain";
import {
  openapiPlugin,
  type OpenApiSpecStore,
  type StoredSpec,
  type OpenApiOperation,
} from "../__fixtures__/openapi";
import { graphqlPlugin } from "../__fixtures__/graphql";

const scope = {
  id: "test-scope",
  name: "Test Scope",
  createdAt: new Date(),
};

const buildPlugins = () =>
  [keychainPlugin(), openapiPlugin(), graphqlPlugin()] as const;

const runWithSql = <A>(
  program: (sql: SqlClient.SqlClient) => Effect.Effect<A, Error>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* program(sql);
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
    Effect.scoped,
    Effect.runPromise,
  );

describe("sdk-greenfield end-to-end (core data model)", () => {
  test("migrate + createExecutor + add sources + invoke tools", async () => {
    const plugins = buildPlugins();

    await runWithSql((sql) =>
      Effect.gen(function* () {
        const schema = collectSchemas(plugins);
        yield* migrate(sql, schema);

        const adapter = makeSqlAdapter({ sql, schema });
        const blobs = makeInMemoryBlobStore();
        const executor = yield* createExecutor({
          scope,
          adapter,
          blobs,
          plugins,
        });

        // After createExecutor, the core `source` table should
        // contain the two static control sources (openapi.control,
        // graphql.control). keychain contributes none.
        const initialSources = yield* executor.sources.list();
        expect(initialSources.map((s) => s.id).sort()).toEqual([
          "graphql.control",
          "openapi.control",
        ]);

        // Core `tool` table has three rows: two from openapi.control,
        // one from graphql.control.
        const initialTools = yield* executor.tools.list();
        expect(initialTools.map((t) => t.id).sort()).toEqual([
          "graphql.control.add-endpoint",
          "openapi.control.add-source",
          "openapi.control.preview-spec",
        ]);

        // Every tool has `sourceId` set correctly — that's the core
        // data model enforcing "tools belong to sources."
        for (const tool of initialTools) {
          expect(initialSources.some((s) => s.id === tool.sourceId)).toBe(
            true,
          );
        }

        // Add an OpenAPI spec via the extension API. This should
        // write plugin enrichment (openapi_operation rows + spec
        // blob) AND core metadata (source + tool rows) in one
        // transaction.
        const added = yield* executor.openapi.addSpec({
          namespace: "petstore",
          name: "Petstore",
          baseUrl: "https://petstore.example.com",
          spec: "{ \"openapi\": \"3.0.0\" }",
          operations: [
            { toolName: "listPets", method: "GET", path: "/pets" },
            { toolName: "getPet", method: "GET", path: "/pets/{id}" },
          ],
        });
        expect(added).toEqual({ sourceId: "petstore", toolCount: 2 });

        // Add a GraphQL endpoint via the extension API. GraphQL has no
        // plugin-specific enrichment — this only writes to core.
        yield* executor.graphql.addEndpoint({
          id: "github",
          name: "GitHub GraphQL",
          endpoint: "https://api.github.com/graphql",
        });

        // Keychain secret round-trip — unchanged from before.
        yield* executor.secrets.set("petstore.apikey", "sk-123", "keychain");
        expect(yield* executor.secrets.get("petstore.apikey")).toBe("sk-123");

        // Sources list now has both control sources + petstore + github.
        const allSources = yield* executor.sources.list();
        expect(allSources.map((s) => s.id).sort()).toEqual([
          "github",
          "graphql.control",
          "openapi.control",
          "petstore",
        ]);

        // Tools list has all six.
        const allTools = yield* executor.tools.list();
        expect(allTools.map((t) => t.id).sort()).toEqual([
          "github.query",
          "graphql.control.add-endpoint",
          "openapi.control.add-source",
          "openapi.control.preview-spec",
          "petstore.getPet",
          "petstore.listPets",
        ]);

        // Invoke a dynamic openapi tool — routes through the core
        // `tool` table lookup, then delegates to openapi.invokeTool,
        // which fetches the operation binding from plugin storage.
        const result = (yield* executor.tools.invoke("petstore.listPets", {
          limit: 10,
        })) as {
          source: string;
          tool: string;
          method: string;
          path: string;
          args: { limit: number };
        };
        expect(result).toEqual({
          source: "petstore",
          tool: "listPets",
          method: "GET",
          path: "/pets",
          args: { limit: 10 },
        });

        // Invoke a static control tool — same core lookup path, same
        // delegation. The plugin dispatches on toolId internally.
        const control = (yield* executor.tools.invoke(
          "openapi.control.preview-spec",
          { spec: "..." },
        )) as { previewed: boolean };
        expect(control.previewed).toBe(true);

        // Direct-query the core tables to verify the split persistence:
        // core source + tool tables are populated for petstore, and
        // the openapi_operation (plugin enrichment) table has the
        // binding data.
        const sourceRows = yield* adapter.findMany<Record<string, unknown>>({
          model: "source",
          where: [{ field: "id", value: "petstore" }],
        });
        expect(sourceRows).toHaveLength(1);
        expect(sourceRows[0]).toMatchObject({
          id: "petstore",
          plugin_id: "openapi",
          kind: "openapi",
          name: "Petstore",
        });
        // Audit columns populate automatically on write.
        expect(sourceRows[0]!.created_at).toBeTruthy();
        expect(sourceRows[0]!.updated_at).toBeTruthy();

        const operationRows = yield* adapter.findMany<Record<string, unknown>>(
          {
            model: "openapi_operation",
            where: [{ field: "source_id", value: "petstore" }],
          },
        );
        expect(operationRows).toHaveLength(2);

        // Core tool rows also have audit columns.
        const toolRows = yield* adapter.findMany<Record<string, unknown>>({
          model: "tool",
          where: [{ field: "source_id", value: "petstore" }],
        });
        expect(toolRows).toHaveLength(2);
        for (const row of toolRows) {
          expect(row.created_at).toBeTruthy();
          expect(row.updated_at).toBeTruthy();
        }

        // Plugin-specific details via the extension API — exactly the
        // "call the plugin for details" pattern. Core doesn't know
        // openapi's method/path; only the plugin does.
        const binding = yield* executor.openapi.getOperation(
          "petstore",
          "listPets",
        );
        expect(binding).toMatchObject({
          toolName: "listPets",
          method: "GET",
          path: "/pets",
        });

        // The raw spec blob is also fetchable through the extension.
        const storedSpec = yield* executor.openapi.getSpec("petstore");
        expect(storedSpec?.spec).toContain("openapi");

        yield* executor.close();
      }),
    );
  });

  test("persistence across executor instances (no rehydration loop)", async () => {
    const plugins = buildPlugins();

    await runWithSql((sql) =>
      Effect.gen(function* () {
        const schema = collectSchemas(plugins);
        yield* migrate(sql, schema);

        const adapter = makeSqlAdapter({ sql, schema });
        const blobs = makeInMemoryBlobStore();

        // First executor: populate state.
        const first = yield* createExecutor({ scope, adapter, blobs, plugins });
        yield* first.openapi.addSpec({
          namespace: "petstore",
          name: "Petstore",
          spec: "{}",
          operations: [
            { toolName: "listPets", method: "GET", path: "/pets" },
          ],
        });
        yield* first.graphql.addEndpoint({
          id: "github",
          name: "GitHub",
          endpoint: "https://api.github.com/graphql",
        });
        yield* first.close();

        // Second executor: the core tables already have petstore +
        // github. No plugin init reads them — the executor just
        // starts up, upserts its static control sources (writes,
        // bounded by plugin count), and returns. When
        // `second.sources.list()` is called, it's a core query that
        // returns everything.
        const second = yield* createExecutor({
          scope,
          adapter,
          blobs,
          plugins,
        });
        const sources = yield* second.sources.list();
        const ids = sources.map((s) => s.id).sort();
        expect(ids).toEqual([
          "github",
          "graphql.control",
          "openapi.control",
          "petstore",
        ]);

        // And the dynamic openapi tool is reachable — the core lookup
        // finds the tool row, delegates to the plugin's invokeTool,
        // which fetches the operation binding from plugin storage.
        const result = (yield* second.tools.invoke("petstore.listPets", {
          limit: 5,
        })) as { source: string; tool: string };
        expect(result.source).toBe("petstore");
        expect(result.tool).toBe("listPets");

        yield* second.close();
      }),
    );
  });

  test("Pattern C: custom OpenApiSpecStore skips plugin enrichment", async () => {
    // The tracking store keeps plugin enrichment in memory and skips
    // every blob/adapter write for openapi-owned data. Core source
    // and tool tables are NOT skipped — they're written through
    // ctx.core.sources.register, which is a separate, shared path.
    const makeTrackingStore = () => {
      const specs = new Map<string, StoredSpec>();
      const calls = {
        upsertSpec: 0,
        getSpec: 0,
        getOperation: 0,
        removeSpec: 0,
      };
      const store: OpenApiSpecStore = {
        upsertSpec: (input) =>
          Effect.sync(() => {
            calls.upsertSpec++;
            specs.set(input.namespace, {
              id: input.namespace,
              spec: input.spec,
              operations: input.operations,
            });
          }),
        getSpec: (id) =>
          Effect.sync(() => {
            calls.getSpec++;
            return specs.get(id) ?? null;
          }),
        getOperation: (sourceId, toolName) =>
          Effect.sync(() => {
            calls.getOperation++;
            const spec = specs.get(sourceId);
            if (!spec) return null;
            const op = spec.operations.find(
              (o: OpenApiOperation) => o.toolName === toolName,
            );
            return op ?? null;
          }),
        removeSpec: (id) =>
          Effect.sync(() => {
            calls.removeSpec++;
            specs.delete(id);
          }),
      };
      return { store, specs, calls };
    };

    const tracking = makeTrackingStore();

    const plugins = [
      keychainPlugin(),
      openapiPlugin({ storage: () => tracking.store }),
      graphqlPlugin(),
    ] as const;

    await runWithSql((sql) =>
      Effect.gen(function* () {
        const schema = collectSchemas(plugins);
        yield* migrate(sql, schema);

        const adapter = makeSqlAdapter({ sql, schema });
        const blobs = makeInMemoryBlobStore();
        const executor = yield* createExecutor({
          scope,
          adapter,
          blobs,
          plugins,
        });

        yield* executor.openapi.addSpec({
          namespace: "petstore",
          name: "Petstore",
          baseUrl: "https://petstore.example.com",
          spec: "{ \"openapi\": \"3.0.0\" }",
          operations: [
            { toolName: "listPets", method: "GET", path: "/pets" },
          ],
        });

        // Plugin enrichment was tracked, not written.
        expect(tracking.calls.upsertSpec).toBe(1);
        expect(tracking.specs.size).toBe(1);

        // The plugin-owned `openapi_operation` table is empty — the
        // tracking store skipped it.
        const opRows = yield* adapter.findMany<Record<string, unknown>>({
          model: "openapi_operation",
        });
        expect(opRows).toHaveLength(0);

        // The blob store in the 'openapi' namespace is empty — also
        // skipped.
        const specBlob = yield* blobs.get("openapi", "source/petstore/spec");
        expect(specBlob).toBeNull();

        // But the CORE source + tool tables ARE populated — that write
        // went through ctx.core.sources.register, which is a separate
        // path the tracking store never saw. This is the important
        // architectural property: Pattern C overrides plugin-specific
        // storage but doesn't bypass the core data model.
        const sourceRows = yield* adapter.findMany<Record<string, unknown>>({
          model: "source",
          where: [{ field: "id", value: "petstore" }],
        });
        expect(sourceRows).toHaveLength(1);

        const toolRows = yield* adapter.findMany<Record<string, unknown>>({
          model: "tool",
          where: [{ field: "source_id", value: "petstore" }],
        });
        expect(toolRows).toHaveLength(1);

        // sources.list() reflects both the core-registered source and
        // the static control source.
        const allSources = yield* executor.sources.list();
        const dynamicSources = allSources.filter(
          (s) => !s.id.endsWith(".control"),
        );
        expect(dynamicSources.map((s) => s.id)).toEqual(["petstore"]);

        // Tool invocation still works — the core lookup finds the
        // tool row, delegates to openapi.invokeTool, which calls the
        // tracking store's getOperation to fetch the binding, then
        // executes the stub.
        const result = (yield* executor.tools.invoke("petstore.listPets", {
          limit: 3,
        })) as { source: string; tool: string; method: string };
        expect(result.source).toBe("petstore");
        expect(result.method).toBe("GET");
        expect(tracking.calls.getOperation).toBeGreaterThanOrEqual(1);

        yield* executor.close();
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Tagged errors at the executor surface. Consumers can pattern-match
  // on `_tag` instead of string-matching error messages.
  // -----------------------------------------------------------------------
  test("executor surfaces tagged errors (ToolNotFound, PluginNotLoaded, SourceRemovalNotAllowed)", async () => {
    const plugins = buildPlugins();

    await runWithSql((sql) =>
      Effect.gen(function* () {
        const schema = collectSchemas(plugins);
        yield* migrate(sql, schema);
        const adapter = makeSqlAdapter({ sql, schema });
        const blobs = makeInMemoryBlobStore();
        const executor = yield* createExecutor({
          scope,
          adapter,
          blobs,
          plugins,
        });

        // 1. ToolNotFoundError — invoke a toolId that doesn't exist.
        const notFoundExit = yield* Effect.exit(
          executor.tools.invoke("nonexistent.tool", {}),
        );
        expect(Exit.isFailure(notFoundExit)).toBe(true);
        if (Exit.isFailure(notFoundExit)) {
          const error = Cause.failureOption(notFoundExit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(ToolNotFoundError);
            expect((error.value as ToolNotFoundError).toolId).toBe(
              "nonexistent.tool",
            );
          }
        }

        // 2. SourceRemovalNotAllowedError — try to remove a static
        // control source (openapi.control has canRemove: false).
        const removalExit = yield* Effect.exit(
          executor.sources.remove("openapi.control"),
        );
        expect(Exit.isFailure(removalExit)).toBe(true);
        if (Exit.isFailure(removalExit)) {
          const error = Cause.failureOption(removalExit.cause);
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(SourceRemovalNotAllowedError);
            expect(
              (error.value as SourceRemovalNotAllowedError).sourceId,
            ).toBe("openapi.control");
          }
        }

        // Confirm the static source is still there.
        const stillThere = yield* adapter.findOne<Record<string, unknown>>({
          model: "source",
          where: [{ field: "id", value: "openapi.control" }],
        });
        expect(stillThere).not.toBeNull();

        // 3. ToolInvocationError — handler raises, executor wraps.
        // The graphql plugin's invokeTool rejects any dynamic tool
        // whose name isn't "query". We can exercise that by manually
        // inserting a fake tool row with a bogus name and invoking it.
        yield* executor.graphql.addEndpoint({
          id: "fake-gql",
          name: "Fake",
          endpoint: "https://fake.example.com",
        });
        // Insert a bogus tool row directly so we can hit the
        // "unknown dynamic tool" error path inside graphql.invokeTool.
        const now = new Date();
        yield* adapter.create({
          model: "tool",
          data: {
            id: "fake-gql.bogus",
            source_id: "fake-gql",
            plugin_id: "graphql",
            name: "bogus",
            description: "not a real tool",
            input_schema: null,
            output_schema: null,
            created_at: now,
            updated_at: now,
          },
          forceAllowId: true,
        });
        const invokeExit = yield* Effect.exit(
          executor.tools.invoke("fake-gql.bogus", {}),
        );
        expect(Exit.isFailure(invokeExit)).toBe(true);
        if (Exit.isFailure(invokeExit)) {
          const error = Cause.failureOption(invokeExit.cause);
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(ToolInvocationError);
            expect((error.value as ToolInvocationError).toolId).toBe(
              "fake-gql.bogus",
            );
          }
        }

        yield* executor.close();
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Atomic transaction: if the plugin's extension method raises in the
  // middle of an addSpec-style operation, the core source/tool tables
  // AND the plugin enrichment should both roll back — nothing is left
  // half-written.
  // -----------------------------------------------------------------------
  test("atomic transaction: addSpec rolls back core + plugin writes on failure", async () => {
    // A tracking store whose upsertSpec intentionally fails.
    const failingStore: OpenApiSpecStore = {
      upsertSpec: () =>
        new SimulatedFailure({ message: "simulated plugin storage failure" }),
      getSpec: () => Effect.succeed(null),
      getOperation: () => Effect.succeed(null),
      removeSpec: () => Effect.void,
    };

    const plugins = [
      keychainPlugin(),
      openapiPlugin({ storage: () => failingStore }),
      graphqlPlugin(),
    ] as const;

    await runWithSql((sql) =>
      Effect.gen(function* () {
        const schema = collectSchemas(plugins);
        yield* migrate(sql, schema);
        const adapter = makeSqlAdapter({ sql, schema });
        const blobs = makeInMemoryBlobStore();
        const executor = yield* createExecutor({
          scope,
          adapter,
          blobs,
          plugins,
        });

        // addSpec will call upsertSpec (fails) then would call
        // core.sources.register. The transaction wrapper should
        // prevent any of the core writes from committing.
        const exit = yield* Effect.exit(
          executor.openapi.addSpec({
            namespace: "petstore",
            name: "Petstore",
            spec: "{}",
            operations: [
              { toolName: "listPets", method: "GET", path: "/pets" },
            ],
          }),
        );
        expect(Exit.isFailure(exit)).toBe(true);

        // Neither the core source row nor any tool rows should exist.
        const sourceRows = yield* adapter.findMany({
          model: "source",
          where: [{ field: "id", value: "petstore" }],
        });
        expect(sourceRows).toHaveLength(0);

        const toolRows = yield* adapter.findMany({
          model: "tool",
          where: [{ field: "source_id", value: "petstore" }],
        });
        expect(toolRows).toHaveLength(0);

        yield* executor.close();
      }),
    );
  });

  // -----------------------------------------------------------------------
  // JSON columns round-trip: input_schema / output_schema are stored as
  // JSON strings in SQLite but should come back as parsed objects when
  // read via `executor.tools.list()`.
  // -----------------------------------------------------------------------
  test("JSON schema columns round-trip correctly", async () => {
    const plugins = buildPlugins();

    await runWithSql((sql) =>
      Effect.gen(function* () {
        const schema = collectSchemas(plugins);
        yield* migrate(sql, schema);
        const adapter = makeSqlAdapter({ sql, schema });
        const blobs = makeInMemoryBlobStore();
        const executor = yield* createExecutor({
          scope,
          adapter,
          blobs,
          plugins,
        });

        // Directly register a source + tool with a populated
        // input_schema to exercise the decode path. We do this
        // through the core adapter because neither stub plugin
        // populates schemas in their extension calls yet.
        const now = new Date();
        yield* adapter.create({
          model: "source",
          data: {
            id: "schema-test",
            plugin_id: "openapi",
            kind: "openapi",
            name: "Schema Test",
            url: null,
            can_remove: true,
            can_refresh: false,
            created_at: now,
            updated_at: now,
          },
          forceAllowId: true,
        });
        yield* adapter.create({
          model: "tool",
          data: {
            id: "schema-test.query",
            source_id: "schema-test",
            plugin_id: "openapi",
            name: "query",
            description: "A test tool with a populated input schema",
            input_schema: {
              type: "object",
              properties: {
                limit: { type: "number" },
                filter: { type: "string" },
              },
            },
            output_schema: { type: "array", items: { type: "object" } },
            created_at: now,
            updated_at: now,
          },
          forceAllowId: true,
        });

        const tools = yield* executor.tools.list();
        const tool = tools.find((t) => t.id === "schema-test.query");
        expect(tool).toBeDefined();
        expect(tool?.inputSchema).toEqual({
          type: "object",
          properties: {
            limit: { type: "number" },
            filter: { type: "string" },
          },
        });
        expect(tool?.outputSchema).toEqual({
          type: "array",
          items: { type: "object" },
        });

        yield* executor.close();
      }),
    );
  });
});
