// ---------------------------------------------------------------------------
// Postgres adapter conformance test
// ---------------------------------------------------------------------------
//
// Gated on TEST_POSTGRES_URL. When unset (the default for local `vitest
// run`) the suite registers a single skipped test and exits — so contribs
// without Docker/Postgres still get a green local run. CI is expected to
// set TEST_POSTGRES_URL against a throw-away database.
//
// Example:
//   TEST_POSTGRES_URL=postgres://user:pass@localhost:5432/executor_test \
//     bun --filter @executor/storage-postgres test

import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import postgres from "postgres";

import type { DBAdapter } from "@executor/storage-core";
import {
  conformanceSchema,
  runAdapterConformance,
} from "@executor/storage-core/testing";

import { makePostgresAdapter, runPostgresMigrations } from "./index";

const url = process.env.TEST_POSTGRES_URL;

if (!url) {
  describe("conformance: postgres", () => {
    it.skip("TEST_POSTGRES_URL not set — skipping real-postgres conformance", () => {
      // no-op: see header comment
    });
  });
} else {
  const sql = postgres(url, {
    max: 5,
    idle_timeout: 0,
    max_lifetime: 60,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  // Every test starts from an empty schema. We DROP + re-run migrations
  // explicitly; the adapter itself no longer issues DDL on construction.
  const resetTables = Effect.tryPromise({
    try: () =>
      sql`DROP TABLE IF EXISTS "source", "tag", "blob" CASCADE`.then(
        () => undefined,
      ),
    catch: (cause) =>
      new Error(`failed to reset postgres conformance tables: ${String(cause)}`),
  });

  const withAdapter = <A, E>(
    fn: (adapter: DBAdapter) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> =>
    Effect.gen(function* () {
      yield* resetTables;
      yield* runPostgresMigrations({ sql, schema: conformanceSchema });
      const adapter = yield* makePostgresAdapter({
        sql,
        schema: conformanceSchema,
      });
      return yield* fn(adapter);
    }) as Effect.Effect<A, E | Error>;

  runAdapterConformance("postgres", withAdapter);
}
