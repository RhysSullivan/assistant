// ---------------------------------------------------------------------------
// @executor/storage-postgres — DBAdapter backed by drizzle-orm/postgres-js.
//
// Thin wrapper: compiles the DBSchema into drizzle pg tables and hands
// everything to @executor/storage-drizzle. All query work happens in
// storage-drizzle; this file is just the postgres-specific plumbing:
// constructing the drizzle db from a `postgres.js` Sql client.
//
// We keep using `postgres.js` (porsager) rather than a `pg`-based
// driver because Cloudflare Workers + Hyperdrive requires a fresh DB
// connection per request; postgres.js creates a fresh TCP socket per
// Effect scope and composes cleanly with `Layer.scoped`.
//
// Migrations are out of scope — consumers run drizzle-kit against the
// pg tables produced by `dbSchemaToPgTables`.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import type { DBAdapter, DBSchema } from "@executor/storage-core";
import { drizzleAdapter } from "@executor/storage-drizzle";

import { dbSchemaToPgCompiled } from "./compile";

// ---------------------------------------------------------------------------
// makePostgresAdapter
// ---------------------------------------------------------------------------

export interface MakePostgresAdapterOptions {
  readonly sql: Sql;
  readonly schema: DBSchema;
  readonly adapterId?: string;
  readonly generateId?: () => string;
}

export const makePostgresAdapter = (
  options: MakePostgresAdapterOptions,
): Effect.Effect<DBAdapter, Error> =>
  Effect.sync(() => {
    const compiled = dbSchemaToPgCompiled(options.schema);
    // Relational queries (findFirst({ with: … })) need the relations in the
    // drizzle schema bag so `db.query[model]` and `db._.fullSchema` are
    // populated. We merge tables + relations under their export names.
    const fullSchema = { ...compiled.tables, ...compiled.relations };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(options.sql, { schema: fullSchema as any });
    return drizzleAdapter({
      db,
      tables: compiled.tables,
      relations: compiled.relations,
      schema: options.schema,
      provider: "pg",
      adapterId: options.adapterId ?? "postgres",
      supportsTransaction: true,
      customIdGenerator: options.generateId
        ? () => options.generateId!()
        : undefined,
    });
  });
