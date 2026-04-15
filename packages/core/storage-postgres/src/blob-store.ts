// ---------------------------------------------------------------------------
// @executor/storage-postgres — BlobStore backed by a `blob` table in the
// same postgres database as the adapter. Keeps plugin-owned opaque blobs
// (onepassword config, workos-vault metadata, etc.) persistent across
// restarts / Worker invocations without needing a second storage seam.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { Sql } from "postgres";

import type { BlobStore } from "@executor/sdk";

const wrapErr =
  (op: string) =>
  (e: unknown): Error => {
    const msg = e instanceof Error ? e.message : String(e);
    return new Error(`[storage-postgres] blob ${op}: ${msg}`);
  };

// DDL is NOT run here — the `blob` table is created by
// `runPostgresMigrations` out-of-band. This keeps Cloudflare Workers
// request paths free of schema-mutation round-trips.
export const makePostgresBlobStore = (
  sql: Sql,
): Effect.Effect<BlobStore, Error> =>
  Effect.gen(function* () {
    return {
      get: (namespace, key) =>
        Effect.tryPromise({
          try: async () => {
            const rows = (await sql.unsafe(
              `SELECT "value" FROM "blob" WHERE "namespace" = $1 AND "key" = $2 LIMIT 1`,
              [namespace, key],
            )) as unknown as ReadonlyArray<{ value: string }>;
            return rows[0]?.value ?? null;
          },
          catch: wrapErr("get"),
        }),
      put: (namespace, key, value) =>
        Effect.tryPromise({
          try: async () => {
            await sql.unsafe(
              `INSERT INTO "blob" ("namespace", "key", "value")
               VALUES ($1, $2, $3)
               ON CONFLICT ("namespace", "key")
               DO UPDATE SET "value" = EXCLUDED."value"`,
              [namespace, key, value],
            );
          },
          catch: wrapErr("put"),
        }),
      delete: (namespace, key) =>
        Effect.tryPromise({
          try: async () => {
            await sql.unsafe(
              `DELETE FROM "blob" WHERE "namespace" = $1 AND "key" = $2`,
              [namespace, key],
            );
          },
          catch: wrapErr("delete"),
        }),
      has: (namespace, key) =>
        Effect.tryPromise({
          try: async () => {
            const rows = (await sql.unsafe(
              `SELECT 1 AS "one" FROM "blob" WHERE "namespace" = $1 AND "key" = $2 LIMIT 1`,
              [namespace, key],
            )) as unknown as ReadonlyArray<unknown>;
            return rows.length > 0;
          },
          catch: wrapErr("has"),
        }),
    };
  });
