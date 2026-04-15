// ---------------------------------------------------------------------------
// DBAdapter conformance suite
// ---------------------------------------------------------------------------
//
// Parameterized test suite every storage backend runs against. One suite,
// N backends — a bug can't land in sqlite and not in postgres (or vice
// versa) without a test failing somewhere.
//
// Consumers call `runAdapterConformance(name, withAdapter)` from their own
// test file, passing a setup function that provides an adapter built
// against the shared `conformanceSchema`. Every assertion below must hold
// for any backend that implements `DBAdapter`.

import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import { Effect } from "effect";

import type { DBAdapter } from "../adapter";
import type { DBSchema } from "../schema";

// ---------------------------------------------------------------------------
// Shared schema — exercises every column type the plugin surface uses
// ---------------------------------------------------------------------------

export const conformanceSchema: DBSchema = {
  source: {
    modelName: "source",
    fields: {
      name: { type: "string", required: true },
      priority: { type: "number" },
      enabled: { type: "boolean" },
      createdAt: { type: "date" },
      metadata: { type: "json" },
    },
  },
  tag: {
    modelName: "tag",
    fields: {
      label: { type: "string", required: true },
    },
  },
};

export type WithAdapter = <A, E>(
  fn: (adapter: DBAdapter) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | Error>;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

export const runAdapterConformance = (
  name: string,
  withAdapter: WithAdapter,
): void => {
  describe(`conformance: ${name}`, () => {
    it.effect("create + findOne round-trips coerced columns", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          const created = yield* adapter.create<{
            id: string;
            name: string;
            priority: number;
            enabled: boolean;
            createdAt: Date;
            metadata: Record<string, unknown>;
          }>({
            model: "source",
            data: {
              name: "github",
              priority: 10,
              enabled: true,
              createdAt: new Date("2026-04-15T00:00:00.000Z"),
              metadata: { slug: "gh", tags: ["a", "b"] },
            },
          });

          expect(created.id).toBeDefined();
          expect(created.name).toBe("github");
          expect(created.enabled).toBe(true);
          expect(created.metadata).toEqual({ slug: "gh", tags: ["a", "b"] });

          const found = yield* adapter.findOne<{
            id: string;
            name: string;
            enabled: boolean;
            createdAt: Date;
            metadata: Record<string, unknown>;
          }>({
            model: "source",
            where: [{ field: "name", value: "github" }],
          });

          expect(found).not.toBeNull();
          expect(found!.id).toBe(created.id);
          expect(found!.enabled).toBe(true);
          expect(found!.createdAt instanceof Date).toBe(true);
          expect(found!.createdAt.toISOString()).toBe(
            "2026-04-15T00:00:00.000Z",
          );
          expect(found!.metadata).toEqual({ slug: "gh", tags: ["a", "b"] });
        }),
      ),
    );

    it.effect("Date columns survive a write path that takes Date instances", () =>
      // Regression: pg-adapter's sql.unsafe path rejected Date instances
      // until we ISO-stringified them in encodeValue. Keep every backend
      // honest on this — a Date in should match a Date out.
      withAdapter((adapter) =>
        Effect.gen(function* () {
          const d = new Date("2001-09-11T12:34:56.789Z");
          const row = yield* adapter.create<{
            id: string;
            name: string;
            createdAt: Date;
          }>({
            model: "source",
            data: { name: "date-test", createdAt: d },
          });
          const found = yield* adapter.findOne<{ createdAt: Date }>({
            model: "source",
            where: [{ field: "id", value: row.id as string }],
          });
          expect(found!.createdAt.toISOString()).toBe(d.toISOString());
        }),
      ),
    );

    it.effect("json columns round-trip nested structures", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          const payload = {
            nested: { a: 1, b: [true, null, "x"] },
            arr: [{ k: "v" }],
          };
          const row = yield* adapter.create<{
            id: string;
            name: string;
            metadata: typeof payload;
          }>({
            model: "source",
            data: { name: "json-test", metadata: payload },
          });
          const found = yield* adapter.findOne<{
            metadata: typeof payload;
          }>({
            model: "source",
            where: [{ field: "id", value: row.id }],
          });
          expect(found!.metadata).toEqual(payload);
        }),
      ),
    );

    it.effect("forceAllowId preserves caller-supplied id", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.create({
            model: "tag",
            forceAllowId: true,
            data: { id: "tag-fixed-1", label: "red" } as unknown as {
              label: string;
            },
          });
          const found = yield* adapter.findOne<{ id: string; label: string }>({
            model: "tag",
            where: [{ field: "id", value: "tag-fixed-1" }],
          });
          expect(found).not.toBeNull();
          expect(found!.id).toBe("tag-fixed-1");
          expect(found!.label).toBe("red");
        }),
      ),
    );

    it.effect("update mutates fields and returns the new row", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          const row = yield* adapter.create<{
            id: string;
            name: string;
            priority: number;
          }>({
            model: "source",
            data: { name: "gitlab", priority: 1 },
          });
          const updated = yield* adapter.update<{
            id: string;
            priority: number;
          }>({
            model: "source",
            where: [{ field: "id", value: row.id }],
            update: { priority: 99 },
          });
          expect(updated).not.toBeNull();
          expect(updated!.priority).toBe(99);
        }),
      ),
    );

    it.effect("delete + count reflect removals", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.createMany({
            model: "tag",
            data: [{ label: "a" }, { label: "b" }, { label: "c" }],
          });
          expect(yield* adapter.count({ model: "tag" })).toBe(3);

          yield* adapter.delete({
            model: "tag",
            where: [{ field: "label", value: "b" }],
          });
          expect(yield* adapter.count({ model: "tag" })).toBe(2);

          const removed = yield* adapter.deleteMany({
            model: "tag",
            where: [
              { field: "label", value: "a" },
              { field: "label", value: "c", connector: "OR" },
            ],
          });
          expect(removed).toBe(2);
          expect(yield* adapter.count({ model: "tag" })).toBe(0);
        }),
      ),
    );

    it.effect("createMany bulk-inserts small batches in order", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          const rows = yield* adapter.createMany<{
            id: string;
            label: string;
          }>({
            model: "tag",
            data: [{ label: "one" }, { label: "two" }, { label: "three" }],
          });
          expect(rows).toHaveLength(3);
          expect(rows.map((r) => r.label)).toEqual(["one", "two", "three"]);
          expect(yield* adapter.count({ model: "tag" })).toBe(3);
        }),
      ),
    );

    it.effect("createMany handles batches larger than a chunk window", () =>
      // Regression: storage-file used to do one Effect.gen per row and
      // hung on 1000+ rows. The fix was chunked sql.insert at 500. Keep
      // every backend honest on large inputs.
      withAdapter((adapter) =>
        Effect.gen(function* () {
          const N = 1200;
          const data = Array.from({ length: N }, (_, i) => ({
            label: `bulk-${i}`,
          }));
          const rows = yield* adapter.createMany<{
            id: string;
            label: string;
          }>({ model: "tag", data });
          expect(rows).toHaveLength(N);
          expect(yield* adapter.count({ model: "tag" })).toBe(N);
        }),
      ),
    );

    it.effect("findMany supports sort + limit + offset", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.createMany({
            model: "source",
            data: [
              { name: "a", priority: 3 },
              { name: "b", priority: 1 },
              { name: "c", priority: 2 },
            ],
          });
          const asc = yield* adapter.findMany<{
            name: string;
            priority: number;
          }>({
            model: "source",
            sortBy: { field: "priority", direction: "asc" },
          });
          expect(asc.map((r) => r.name)).toEqual(["b", "c", "a"]);

          const firstDesc = yield* adapter.findMany<{ name: string }>({
            model: "source",
            sortBy: { field: "priority", direction: "desc" },
            limit: 1,
          });
          expect(firstDesc.map((r) => r.name)).toEqual(["a"]);

          const offset1 = yield* adapter.findMany<{ name: string }>({
            model: "source",
            sortBy: { field: "priority", direction: "asc" },
            offset: 1,
          });
          expect(offset1.map((r) => r.name)).toEqual(["c", "a"]);
        }),
      ),
    );

    it.effect("where operators: contains, starts_with, ends_with, gte", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.createMany({
            model: "source",
            data: [
              { name: "github-main", priority: 1 },
              { name: "github-edge", priority: 5 },
              { name: "gitlab", priority: 10 },
            ],
          });

          const contains = yield* adapter.findMany<{ name: string }>({
            model: "source",
            where: [{ field: "name", value: "git", operator: "contains" }],
          });
          expect(contains).toHaveLength(3);

          const starts = yield* adapter.findMany<{ name: string }>({
            model: "source",
            where: [{ field: "name", value: "github", operator: "starts_with" }],
          });
          expect(starts).toHaveLength(2);

          const ends = yield* adapter.findMany<{ name: string }>({
            model: "source",
            where: [{ field: "name", value: "lab", operator: "ends_with" }],
          });
          expect(ends).toHaveLength(1);
          expect(ends[0]!.name).toBe("gitlab");

          const highPriority = yield* adapter.findMany<{ name: string }>({
            model: "source",
            where: [{ field: "priority", value: 5, operator: "gte" }],
          });
          expect(highPriority.map((r) => r.name).sort()).toEqual([
            "github-edge",
            "gitlab",
          ]);
        }),
      ),
    );

    it.effect("where operator: in / not_in", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.createMany({
            model: "tag",
            data: [{ label: "a" }, { label: "b" }, { label: "c" }],
          });
          const some = yield* adapter.findMany<{ label: string }>({
            model: "tag",
            where: [{ field: "label", value: ["a", "c"], operator: "in" }],
          });
          expect(some.map((r) => r.label).sort()).toEqual(["a", "c"]);

          const none = yield* adapter.findMany<{ label: string }>({
            model: "tag",
            where: [{ field: "label", value: ["a", "c"], operator: "not_in" }],
          });
          expect(none.map((r) => r.label)).toEqual(["b"]);
        }),
      ),
    );

    it.effect("insensitive string comparison", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.create({ model: "tag", data: { label: "RED" } });
          const hit = yield* adapter.findOne<{ label: string }>({
            model: "tag",
            where: [{ field: "label", value: "red", mode: "insensitive" }],
          });
          expect(hit).not.toBeNull();
          expect(hit!.label).toBe("RED");
        }),
      ),
    );

    it.effect("transaction rolls back on failure", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          const before = yield* adapter.count({ model: "tag" });
          const result = yield* adapter
            .transaction((trx) =>
              Effect.gen(function* () {
                yield* trx.create({ model: "tag", data: { label: "tx1" } });
                yield* trx.create({ model: "tag", data: { label: "tx2" } });
                return yield* Effect.fail(new Error("boom"));
              }),
            )
            .pipe(Effect.either);
          expect(result._tag).toBe("Left");
          const after = yield* adapter.count({ model: "tag" });
          expect(after).toBe(before);
        }),
      ),
    );

    it.effect("transaction commits on success", () =>
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.transaction((trx) =>
            Effect.gen(function* () {
              yield* trx.create({ model: "tag", data: { label: "ok1" } });
              yield* trx.create({ model: "tag", data: { label: "ok2" } });
            }),
          );
          expect(yield* adapter.count({ model: "tag" })).toBe(2);
        }),
      ),
    );

    it.effect("nested writes inside a transaction see the tx state", () =>
      // Regression / forward test: apps/cloud deadlocked because nested
      // writes routed around the active tx connection. When ctx.transaction
      // becomes real (FiberRef-threaded), this must still pass — reads and
      // writes inside the callback must observe in-flight tx state.
      withAdapter((adapter) =>
        Effect.gen(function* () {
          yield* adapter.transaction((trx) =>
            Effect.gen(function* () {
              yield* trx.create({ model: "tag", data: { label: "inside" } });
              const c = yield* trx.count({ model: "tag" });
              expect(c).toBe(1);
            }),
          );
          expect(yield* adapter.count({ model: "tag" })).toBe(1);
        }),
      ),
    );
  });
};
