// ---------------------------------------------------------------------------
// Postgres adapter conformance test
// ---------------------------------------------------------------------------
//
// Runs against PGlite spun up by `scripts/test-globalsetup.ts` (same
// pattern apps/cloud uses). Port 5435 so it doesn't clash with the
// cloud test DB on 5434.

import { Effect } from "effect";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

import type { DBAdapter } from "@executor/storage-core";
import {
  conformanceSchema,
  runAdapterConformance,
} from "@executor/storage-core/testing";

import { makePostgresAdapter } from "./index";

const url = "postgresql://postgres:postgres@127.0.0.1:5435/postgres";

// max=1 so BEGIN/COMMIT sent via `db.execute(sql.raw(...))` always hit
// the same connection — postgres.js with a larger pool rejects unsafe
// transaction control that isn't bound to a single reserved client.
const sql = postgres(url, {
  max: 1,
  idle_timeout: 0,
  max_lifetime: 60,
  connect_timeout: 10,
  onnotice: () => undefined,
});

// Drizzle table definitions matching conformanceSchema
const source = pgTable("source", {
  id: text("id").primaryKey(),
  name: text("name"),
  priority: doublePrecision("priority"),
  enabled: boolean("enabled"),
  createdAt: timestamp("createdAt"),
  metadata: jsonb("metadata"),
});

const tag = pgTable("tag", {
  id: text("id").primaryKey(),
  label: text("label"),
});

const source_tag = pgTable("source_tag", {
  id: text("id").primaryKey(),
  sourceId: text("sourceId").references(() => source.id, { onDelete: "cascade" }),
  note: text("note"),
});

const with_defaults = pgTable("with_defaults", {
  id: text("id").primaryKey(),
  name: text("name"),
  nickname: text("nickname"),
  touchedAt: timestamp("touchedAt"),
});

const sourceRelations = relations(source, ({ many }) => ({
  source_tag: many(source_tag),
}));

const sourceTagRelations = relations(source_tag, ({ one }) => ({
  source: one(source, {
    fields: [source_tag.sourceId],
    references: [source.id],
  }),
}));

const conformanceTables = {
  source,
  tag,
  source_tag,
  with_defaults,
  sourceRelations,
  sourceTagRelations,
};

const createConformanceTables = Effect.tryPromise({
  try: async () => {
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "source" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT,
        "priority" DOUBLE PRECISION,
        "enabled" BOOLEAN,
        "createdAt" TIMESTAMPTZ,
        "metadata" JSONB
      )`,
    );
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "tag" (
        "id" TEXT PRIMARY KEY,
        "label" TEXT
      )`,
    );
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "source_tag" (
        "id" TEXT PRIMARY KEY,
        "sourceId" TEXT REFERENCES "source"("id") ON DELETE CASCADE,
        "note" TEXT
      )`,
    );
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "with_defaults" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT,
        "nickname" TEXT,
        "touchedAt" TIMESTAMPTZ
      )`,
    );
  },
  catch: (cause) =>
    new Error(
      `failed to create postgres conformance tables: ${String(cause)}`,
    ),
});

const resetTables = Effect.gen(function* () {
  yield* Effect.tryPromise({
    try: () =>
      sql`DROP TABLE IF EXISTS "source", "tag", "source_tag", "with_defaults", "blob" CASCADE`.then(
        () => undefined,
      ),
    catch: (cause) =>
      new Error(
        `failed to reset postgres conformance tables: ${String(cause)}`,
      ),
  });
  yield* createConformanceTables;
});

const withAdapter = <A, E>(
  fn: (adapter: DBAdapter) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Error> =>
  Effect.gen(function* () {
    yield* resetTables;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(sql, { schema: conformanceTables as any });
    const adapter = makePostgresAdapter({
      db,
      schema: conformanceSchema,
    });
    return yield* fn(adapter);
  }) as Effect.Effect<A, E | Error>;

runAdapterConformance("postgres", withAdapter);
