// ---------------------------------------------------------------------------
// Database service — Hyperdrive on Cloudflare, node-postgres for local dev
// ---------------------------------------------------------------------------
//
// Migrations are run out-of-band (e.g. via a separate script or CI step),
// not at request time — Cloudflare Workers cannot read the filesystem.

import { env } from "cloudflare:workers";
import { Context, Effect, Layer } from "effect";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as sharedSchema from "@executor/storage-postgres/schema";
import * as cloudSchema from "./schema";
import type { DrizzleDb } from "@executor/storage-postgres";
import { server } from "../env";

const schema = { ...sharedSchema, ...cloudSchema };

export type { DrizzleDb };

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

const resolveConnectionString = () =>
  env.HYPERDRIVE?.connectionString ?? server.DATABASE_URL;

const acquirePostgres = (connectionString: string) =>
  Effect.tryPromise(async () => {
    const client = new Client({ connectionString });
    await client.connect();
    return { db: drizzle(client, { schema }) as DrizzleDb, client };
  });

const releasePostgres = ({
  client,
}: {
  client: { end: () => Promise<void> };
}) =>
  Effect.promise(() => client.end()).pipe(
    Effect.orElseSucceed(() => undefined),
  );

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DbService extends Context.Tag("@executor/cloud/DbService")<
  DbService,
  DrizzleDb
>() {
  /** Scoped — connection released when the scope closes. Use for request handlers. */
  static Live = Layer.scoped(
    this,
    Effect.gen(function* () {
      const { db } = yield* Effect.acquireRelease(
        acquirePostgres(resolveConnectionString()),
        releasePostgres,
      );
      return db;
    }),
  );

  /** Unscoped — connection stays open. Use for long-lived contexts like Durable Objects. */
  static Unscoped = Layer.effect(
    this,
    Effect.flatMap(
      Effect.sync(resolveConnectionString),
      (cs) => acquirePostgres(cs).pipe(Effect.map(({ db }) => db)),
    ),
  );
}
