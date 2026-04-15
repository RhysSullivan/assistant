// ---------------------------------------------------------------------------
// @executor/storage-postgres
//
// Postgres-backed storage primitives for the executor runtime:
//
//   - makePostgresAdapter(options) — a DBAdapter built on `postgres.js`
//     (porsager). Works in node/bun servers AND in Cloudflare Workers +
//     Hyperdrive environments because postgres.js creates a fresh TCP
//     socket per Effect scope (required for Hyperdrive's per-request
//     connection model).
//
//   - makePostgresBlobStore(sql) — a BlobStore backed by a `blob` table
//     in the same database. Used by plugins that persist opaque config
//     (onepassword config, workos-vault metadata, etc.).
//
// Hosts wire them up inside a Layer.scoped / Effect.acquireRelease that
// creates a postgres.js Sql client per request (or per long-lived scope),
// then construct both the adapter and blob store against that sql.
// ---------------------------------------------------------------------------

export {
  makePostgresAdapter,
  type MakePostgresAdapterOptions,
  runPostgresMigrations,
  type RunPostgresMigrationsOptions,
} from "./adapter";

export { makePostgresBlobStore } from "./blob-store";
