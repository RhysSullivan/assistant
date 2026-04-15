import { Effect } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-node";
import * as SqlClient from "@effect/sql/SqlClient";

import type { DBAdapter } from "@executor/storage-core";
import {
  conformanceSchema,
  runAdapterConformance,
} from "@executor/storage-core/testing";

import { makeSqliteAdapter } from "./index";

const TestSqlLayer = SqliteClient.layer({ filename: ":memory:" });

const withAdapter = <A, E>(
  fn: (adapter: DBAdapter) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Error> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const adapter = yield* makeSqliteAdapter({
      sql,
      schema: conformanceSchema,
    });
    return yield* fn(adapter);
  }).pipe(Effect.provide(TestSqlLayer)) as Effect.Effect<A, E | Error>;

runAdapterConformance("sqlite (in-memory)", withAdapter);
