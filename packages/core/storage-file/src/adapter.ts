// ---------------------------------------------------------------------------
// makeSqliteAdapter — thin wrapper around @executor/storage-drizzle.
//
// Takes a pre-built drizzle sqlite db (either from `drizzle-orm/bun-sqlite`
// or `drizzle-orm/better-sqlite3`) plus a DBSchema, compiles the drizzle
// tables, runs zero-config CREATE TABLE IF NOT EXISTS statements, and
// delegates all query work to the drizzle-backed DBAdapter.
//
// Factory signature CHANGED from the previous @effect/sql-based version:
//   before: makeSqliteAdapter({ sql: SqlClient, schema })
//   after:  makeSqliteAdapter({ db: DrizzleSqliteDB, schema })
//
// Downstream callers (apps/local) must build the drizzle db themselves
// using their preferred sqlite driver:
//
//   import { Database } from "bun:sqlite"
//   import { drizzle } from "drizzle-orm/bun-sqlite"
//   const db = drizzle(new Database("data.db"))
//   const adapter = yield* makeSqliteAdapter({ db, schema })
//
//   // or, under node / vitest:
//   import Database from "better-sqlite3"
//   import { drizzle } from "drizzle-orm/better-sqlite3"
//   const db = drizzle(new Database(":memory:"))
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { sql } from "drizzle-orm";

import type { DBAdapter, DBSchema } from "@executor/storage-core";
import { drizzleAdapter } from "@executor/storage-drizzle";

import {
  buildCreateTableStatements,
  dbSchemaToSqliteCompiled,
} from "./compile";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleSqliteDB = any;

export interface MakeSqliteAdapterOptions {
  /**
   * A pre-built drizzle sqlite database (from drizzle-orm/bun-sqlite or
   * drizzle-orm/better-sqlite3). The adapter calls `db.run(sql...)` to
   * bootstrap tables and hands the same db to the drizzle adapter.
   */
  readonly db: DrizzleSqliteDB;
  readonly schema: DBSchema;
  readonly adapterId?: string;
  readonly generateId?: () => string;
}

export const makeSqliteAdapter = (
  options: MakeSqliteAdapterOptions,
): Effect.Effect<DBAdapter, Error> =>
  Effect.gen(function* () {
    const { db, schema } = options;

    // Zero-config bootstrap: create tables if missing. Uses drizzle's
    // raw sql template so we stay driver-agnostic.
    yield* Effect.try({
      try: () => {
        for (const stmt of buildCreateTableStatements(schema)) {
          db.run(sql.raw(stmt));
        }
      },
      catch: (e) =>
        new Error(
          `[storage-file] DDL bootstrap failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
    });

    const compiled = dbSchemaToSqliteCompiled(schema);

    return drizzleAdapter({
      db,
      tables: compiled.tables,
      relations: compiled.relations,
      schema,
      provider: "sqlite",
      adapterId: options.adapterId ?? "sqlite",
      supportsTransaction: true,
      customIdGenerator: options.generateId
        ? () => options.generateId!()
        : undefined,
    });
  });
