// ---------------------------------------------------------------------------
// @executor/storage-file — BlobStore backed by a `blob` table in the
// same SQLite database as the adapter. Keeps plugin-owned opaque blobs
// (onepassword config, workos-vault metadata, etc.) persistent across
// restarts without needing a second storage seam.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type * as SqlClient from "@effect/sql/SqlClient";

import type { BlobStore } from "@executor/sdk";

const wrapErr =
  (op: string) =>
  (e: unknown): Error => {
    const msg = e instanceof Error ? e.message : String(e);
    return new Error(`[storage-file] blob ${op}: ${msg}`);
  };

export const makeSqliteBlobStore = (
  sql: SqlClient.SqlClient,
): Effect.Effect<BlobStore, Error> =>
  Effect.gen(function* () {
    yield* sql
      .unsafe(
        `CREATE TABLE IF NOT EXISTS "blob" (
          "namespace" TEXT NOT NULL,
          "key" TEXT NOT NULL,
          "value" TEXT NOT NULL,
          PRIMARY KEY ("namespace", "key")
        )`,
      )
      .pipe(Effect.mapError(wrapErr("DDL")));

    return {
      get: (namespace, key) =>
        sql<{ value: string }>`
          SELECT "value" FROM "blob"
          WHERE "namespace" = ${namespace} AND "key" = ${key}
          LIMIT 1
        `.pipe(
          Effect.map((rows) => rows[0]?.value ?? null),
          Effect.mapError(wrapErr("get")),
        ),
      put: (namespace, key, value) =>
        sql`
          INSERT INTO "blob" ("namespace", "key", "value")
          VALUES (${namespace}, ${key}, ${value})
          ON CONFLICT ("namespace", "key")
          DO UPDATE SET "value" = excluded."value"
        `.pipe(Effect.asVoid, Effect.mapError(wrapErr("put"))),
      delete: (namespace, key) =>
        sql`
          DELETE FROM "blob"
          WHERE "namespace" = ${namespace} AND "key" = ${key}
        `.pipe(Effect.asVoid, Effect.mapError(wrapErr("delete"))),
      has: (namespace, key) =>
        sql<{ one: number }>`
          SELECT 1 AS "one" FROM "blob"
          WHERE "namespace" = ${namespace} AND "key" = ${key}
          LIMIT 1
        `.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(wrapErr("has")),
        ),
    };
  });
