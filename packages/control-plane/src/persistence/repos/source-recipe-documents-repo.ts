import {
  type StoredSourceRecipeDocumentRecord,
  StoredSourceRecipeDocumentRecordSchema,
} from "#schema";
import { Schema } from "effect";
import { asc, eq, inArray } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { chunkArray } from "./shared";

const decodeStoredSourceRecipeDocumentRecord = Schema.decodeUnknownSync(
  StoredSourceRecipeDocumentRecordSchema,
);

const RECIPE_DOCUMENT_INSERT_BATCH_SIZE = 500;

export const createSourceRecipeDocumentsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listByRevisionId: (recipeRevisionId: StoredSourceRecipeDocumentRecord["recipeRevisionId"]) =>
    client.use("rows.source_recipe_documents.list_by_revision", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceRecipeDocumentsTable)
        .where(eq(tables.sourceRecipeDocumentsTable.recipeRevisionId, recipeRevisionId))
        .orderBy(
          asc(tables.sourceRecipeDocumentsTable.documentKind),
          asc(tables.sourceRecipeDocumentsTable.documentKey),
        );

      return rows.map((row) => decodeStoredSourceRecipeDocumentRecord(row));
    }),

  listByRevisionIds: (
    recipeRevisionIds: readonly StoredSourceRecipeDocumentRecord["recipeRevisionId"][],
  ) =>
    client.use("rows.source_recipe_documents.list_by_revisions", async (db) => {
      if (recipeRevisionIds.length === 0) {
        return [] as StoredSourceRecipeDocumentRecord[];
      }

      const rows = await db
        .select()
        .from(tables.sourceRecipeDocumentsTable)
        .where(inArray(tables.sourceRecipeDocumentsTable.recipeRevisionId, [...recipeRevisionIds]))
        .orderBy(
          asc(tables.sourceRecipeDocumentsTable.recipeRevisionId),
          asc(tables.sourceRecipeDocumentsTable.documentKind),
          asc(tables.sourceRecipeDocumentsTable.documentKey),
        );

      return rows.map((row) => decodeStoredSourceRecipeDocumentRecord(row));
    }),

  replaceForRevision: (input: {
    recipeRevisionId: StoredSourceRecipeDocumentRecord["recipeRevisionId"];
    documents: readonly StoredSourceRecipeDocumentRecord[];
  }) =>
    client.useTx("rows.source_recipe_documents.replace_for_revision", async (tx) => {
      await tx
        .delete(tables.sourceRecipeDocumentsTable)
        .where(eq(tables.sourceRecipeDocumentsTable.recipeRevisionId, input.recipeRevisionId));

      if (input.documents.length > 0) {
        for (const batch of chunkArray(
          input.documents,
          RECIPE_DOCUMENT_INSERT_BATCH_SIZE,
        )) {
          await tx.insert(tables.sourceRecipeDocumentsTable).values([...batch]);
        }
      }
    }),

  removeByRevisionId: (recipeRevisionId: StoredSourceRecipeDocumentRecord["recipeRevisionId"]) =>
    client.use("rows.source_recipe_documents.remove_by_revision", async (db) => {
      const deleted = await db
        .delete(tables.sourceRecipeDocumentsTable)
        .where(eq(tables.sourceRecipeDocumentsTable.recipeRevisionId, recipeRevisionId))
        .returning();

      return deleted.length;
    }),
});
