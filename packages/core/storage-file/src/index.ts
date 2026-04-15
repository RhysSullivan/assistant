// ---------------------------------------------------------------------------
// @executor/storage-file
//
// SQLite-backed DBAdapter for the executor storage-core interface. Thin
// wrapper around @executor/storage-drizzle: compiles the DBSchema into
// drizzle tables (via `./compile`), runs zero-config CREATE TABLE
// statements against a bun:sqlite Database, and delegates all queries to
// the shared drizzle adapter.
//
// Usage:
//
//   import { Database } from "bun:sqlite"
//   import { makeSqliteAdapter } from "@executor/storage-file"
//
//   const database = new Database("data.db")
//   const adapter = yield* makeSqliteAdapter({ database, schema })
// ---------------------------------------------------------------------------

export { makeSqliteAdapter, type MakeSqliteAdapterOptions } from "./adapter";
export {
  dbSchemaToSqliteTables,
  dbSchemaToSqliteCompiled,
  buildCreateTableStatements,
  type CompiledSqliteSchema,
} from "./compile";
export { makeSqliteBlobStore } from "./blob-store";
