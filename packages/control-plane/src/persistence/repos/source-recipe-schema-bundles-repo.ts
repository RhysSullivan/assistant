import {
  type StoredSourceRecipeSchemaBundleRecord,
  StoredSourceRecipeSchemaBundleRecordSchema,
} from "#schema";
import * as Option from "effect/Option";
import { Schema } from "effect";
import { asc, eq, inArray } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption, withoutCreatedAt } from "./shared";

const decodeStoredSourceRecipeSchemaBundleRecord = Schema.decodeUnknownSync(
  StoredSourceRecipeSchemaBundleRecordSchema,
);

export const createSourceRecipeSchemaBundlesRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  getById: (id: StoredSourceRecipeSchemaBundleRecord["id"]) =>
    client.use("rows.source_recipe_schema_bundles.get_by_id", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceRecipeSchemaBundlesTable)
        .where(eq(tables.sourceRecipeSchemaBundlesTable.id, id))
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeStoredSourceRecipeSchemaBundleRecord(row.value))
        : Option.none<StoredSourceRecipeSchemaBundleRecord>();
    }),

  listByRevisionId: (recipeRevisionId: StoredSourceRecipeSchemaBundleRecord["recipeRevisionId"]) =>
    client.use("rows.source_recipe_schema_bundles.list_by_revision", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceRecipeSchemaBundlesTable)
        .where(eq(tables.sourceRecipeSchemaBundlesTable.recipeRevisionId, recipeRevisionId))
        .orderBy(
          asc(tables.sourceRecipeSchemaBundlesTable.bundleKind),
          asc(tables.sourceRecipeSchemaBundlesTable.createdAt),
        );

      return rows.map((row) => decodeStoredSourceRecipeSchemaBundleRecord(row));
    }),

  listByRevisionIds: (
    recipeRevisionIds: readonly StoredSourceRecipeSchemaBundleRecord["recipeRevisionId"][],
  ) =>
    client.use("rows.source_recipe_schema_bundles.list_by_revisions", async (db) => {
      if (recipeRevisionIds.length === 0) {
        return [] as StoredSourceRecipeSchemaBundleRecord[];
      }

      const rows = await db
        .select()
        .from(tables.sourceRecipeSchemaBundlesTable)
        .where(inArray(tables.sourceRecipeSchemaBundlesTable.recipeRevisionId, [...recipeRevisionIds]))
        .orderBy(
          asc(tables.sourceRecipeSchemaBundlesTable.recipeRevisionId),
          asc(tables.sourceRecipeSchemaBundlesTable.bundleKind),
          asc(tables.sourceRecipeSchemaBundlesTable.createdAt),
        );

      return rows.map((row) => decodeStoredSourceRecipeSchemaBundleRecord(row));
    }),

  replaceForRevision: (input: {
    recipeRevisionId: StoredSourceRecipeSchemaBundleRecord["recipeRevisionId"];
    bundles: readonly StoredSourceRecipeSchemaBundleRecord[];
  }) =>
    client.useTx("rows.source_recipe_schema_bundles.replace_for_revision", async (tx) => {
      await tx
        .delete(tables.sourceRecipeSchemaBundlesTable)
        .where(eq(tables.sourceRecipeSchemaBundlesTable.recipeRevisionId, input.recipeRevisionId));

      if (input.bundles.length > 0) {
        await tx.insert(tables.sourceRecipeSchemaBundlesTable).values([...input.bundles]);
      }
    }),

  upsert: (bundle: StoredSourceRecipeSchemaBundleRecord) =>
    client.use("rows.source_recipe_schema_bundles.upsert", async (db) => {
      await db
        .insert(tables.sourceRecipeSchemaBundlesTable)
        .values(bundle)
        .onConflictDoUpdate({
          target: [tables.sourceRecipeSchemaBundlesTable.id],
          set: {
            ...withoutCreatedAt(bundle),
          },
        });
    }),

  removeByRevisionId: (recipeRevisionId: StoredSourceRecipeSchemaBundleRecord["recipeRevisionId"]) =>
    client.use("rows.source_recipe_schema_bundles.remove_by_revision", async (db) => {
      const deleted = await db
        .delete(tables.sourceRecipeSchemaBundlesTable)
        .where(eq(tables.sourceRecipeSchemaBundlesTable.recipeRevisionId, recipeRevisionId))
        .returning();

      return deleted.length;
    }),
});
