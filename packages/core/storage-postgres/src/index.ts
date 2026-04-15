// ---------------------------------------------------------------------------
// @executor/storage-postgres
//
// Postgres-backed storage primitives for the executor runtime. Thin
// wrapper around @executor/storage-drizzle — all query work lives in
// storage-drizzle; this package ships:
//
//   - makePostgresAdapter(options) — a DBAdapter built from a postgres.js
//     Sql client + a DBSchema. Internally compiles drizzle pg tables
//     and hands them to drizzleAdapter.
//
//   - dbSchemaToPgTables(schema) — compile a DBSchema into drizzle pg
//     tables. Migrations are out of scope: consumers run drizzle-kit
//     against these tables.
//
//   - makePostgresBlobStore(sql) — a BlobStore backed by a `blob` table
//     in the same database.
// ---------------------------------------------------------------------------

export {
  makePostgresAdapter,
  type MakePostgresAdapterOptions,
} from "./adapter";

export {
  dbSchemaToPgTables,
  dbSchemaToPgCompiled,
  type CompiledPgSchema,
} from "./compile";

export { makePostgresBlobStore } from "./blob-store";
