import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

import type { DrizzleDb } from "../db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "../../drizzle");

export const createPgliteDb = () =>
  Effect.gen(function* () {
    const client = yield* Effect.promise(() => PGlite.create());
    const db = drizzle(client) as unknown as DrizzleDb;
    yield* Effect.promise(() => migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER }));
    return {
      db,
      close: () => client.close(),
    };
  });
