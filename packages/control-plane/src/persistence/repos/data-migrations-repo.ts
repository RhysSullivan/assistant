import type {
  StoredDataMigrationRecord,
} from "#schema";
import { StoredDataMigrationRecordSchema } from "#schema";
import { Schema } from "effect";
import { asc } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";

const decodeStoredDataMigrationRecord = Schema.decodeUnknownSync(
  StoredDataMigrationRecordSchema,
);

export const createDataMigrationsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listAll: () =>
    client.use("rows.data_migrations.list_all", async (db) => {
      const rows = await db
        .select()
        .from(tables.dataMigrationsTable)
        .orderBy(asc(tables.dataMigrationsTable.appliedAt));

      return rows.map((row) => decodeStoredDataMigrationRecord(row));
    }),

  upsert: (record: StoredDataMigrationRecord) =>
    client.use("rows.data_migrations.upsert", async (db) => {
      await db
        .insert(tables.dataMigrationsTable)
        .values(record)
        .onConflictDoNothing();
    }),

  clearAll: () =>
    client.use("rows.data_migrations.clear_all", async (db) => {
      await db.delete(tables.dataMigrationsTable);
    }),
});
