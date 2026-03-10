import {
  type StoredSourceRecipeOperationRecord,
  StoredSourceRecipeOperationRecordSchema,
} from "#schema";
import { Schema } from "effect";
import { asc, eq, inArray } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { chunkArray } from "./shared";

const decodeStoredSourceRecipeOperationRecord = Schema.decodeUnknownSync(
  StoredSourceRecipeOperationRecordSchema,
);

// Keep wide recipe-operation inserts well below Postgres/PGlite parameter limits.
const RECIPE_OPERATION_INSERT_BATCH_SIZE = 200;

export const createSourceRecipeOperationsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listByRevisionId: (recipeRevisionId: StoredSourceRecipeOperationRecord["recipeRevisionId"]) =>
    client.use("rows.source_recipe_operations.list_by_revision", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceRecipeOperationsTable)
        .where(eq(tables.sourceRecipeOperationsTable.recipeRevisionId, recipeRevisionId))
        .orderBy(
          asc(tables.sourceRecipeOperationsTable.toolId),
          asc(tables.sourceRecipeOperationsTable.id),
        );

      return rows.map((row) => decodeStoredSourceRecipeOperationRecord(row));
    }),

  listByRevisionIds: (
    recipeRevisionIds: readonly StoredSourceRecipeOperationRecord["recipeRevisionId"][],
  ) =>
    client.use("rows.source_recipe_operations.list_by_revisions", async (db) => {
      if (recipeRevisionIds.length === 0) {
        return [] as StoredSourceRecipeOperationRecord[];
      }

      const rows = await db
        .select()
        .from(tables.sourceRecipeOperationsTable)
        .where(inArray(tables.sourceRecipeOperationsTable.recipeRevisionId, [...recipeRevisionIds]))
        .orderBy(
          asc(tables.sourceRecipeOperationsTable.recipeRevisionId),
          asc(tables.sourceRecipeOperationsTable.toolId),
          asc(tables.sourceRecipeOperationsTable.id),
        );

      return rows.map((row) => decodeStoredSourceRecipeOperationRecord(row));
    }),

  replaceForRevision: (input: {
    recipeRevisionId: StoredSourceRecipeOperationRecord["recipeRevisionId"];
    operations: readonly StoredSourceRecipeOperationRecord[];
  }) =>
    client.useTx("rows.source_recipe_operations.replace_for_revision", async (tx) => {
      await tx
        .delete(tables.sourceRecipeOperationsTable)
        .where(eq(tables.sourceRecipeOperationsTable.recipeRevisionId, input.recipeRevisionId));

      if (input.operations.length > 0) {
        for (const batch of chunkArray(
          input.operations,
          RECIPE_OPERATION_INSERT_BATCH_SIZE,
        )) {
          await tx.insert(tables.sourceRecipeOperationsTable).values([...batch]);
        }
      }
    }),

  removeByRevisionId: (recipeRevisionId: StoredSourceRecipeOperationRecord["recipeRevisionId"]) =>
    client.use("rows.source_recipe_operations.remove_by_revision", async (db) => {
      const deleted = await db
        .delete(tables.sourceRecipeOperationsTable)
        .where(eq(tables.sourceRecipeOperationsTable.recipeRevisionId, recipeRevisionId))
        .returning();

      return deleted.length;
    }),
});
