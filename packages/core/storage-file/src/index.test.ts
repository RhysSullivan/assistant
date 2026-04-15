import { Effect } from "effect";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { DBAdapter } from "@executor/storage-core";
import {
  conformanceSchema,
  runAdapterConformance,
} from "@executor/storage-core/testing";

import { makeSqliteAdapter, dbSchemaToSqliteCompiled } from "./index";

const withAdapter = <A, E>(
  fn: (adapter: DBAdapter) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Error> =>
  Effect.gen(function* () {
    const sqlite = new Database(":memory:");
    // Build drizzle with the compiled relational schema so db.query[model]
    // and db._.fullSchema are populated — the join conformance test routes
    // through drizzle's relational query builder.
    const compiled = dbSchemaToSqliteCompiled(conformanceSchema);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(sqlite, {
      schema: { ...compiled.tables, ...compiled.relations } as any,
    });
    const adapter = yield* makeSqliteAdapter({
      db,
      schema: conformanceSchema,
    });
    return yield* fn(adapter);
  }) as Effect.Effect<A, E | Error>;

runAdapterConformance("sqlite (better-sqlite3 via drizzle)", withAdapter);
