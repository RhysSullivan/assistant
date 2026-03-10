import {
  type StoredSourceRecipeRevisionRecord,
  StoredSourceRecipeRevisionRecordSchema,
} from "#schema";
import * as Option from "effect/Option";
import { Schema } from "effect";
import { asc, desc, eq, inArray, and } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption, withoutCreatedAt } from "./shared";

const decodeStoredSourceRecipeRevisionRecord = Schema.decodeUnknownSync(
  StoredSourceRecipeRevisionRecordSchema,
);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type RecipeRevisionPatch = Partial<
  Omit<Mutable<StoredSourceRecipeRevisionRecord>, "id" | "recipeId" | "revisionNumber" | "createdAt">
>;

export const createSourceRecipeRevisionsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listByRecipeId: (recipeId: StoredSourceRecipeRevisionRecord["recipeId"]) =>
    client.use("rows.source_recipe_revisions.list_by_recipe", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceRecipeRevisionsTable)
        .where(eq(tables.sourceRecipeRevisionsTable.recipeId, recipeId))
        .orderBy(
          asc(tables.sourceRecipeRevisionsTable.revisionNumber),
          asc(tables.sourceRecipeRevisionsTable.createdAt),
        );

      return rows.map((row) => decodeStoredSourceRecipeRevisionRecord(row));
    }),

  listByIds: (ids: readonly StoredSourceRecipeRevisionRecord["id"][]) =>
    client.use("rows.source_recipe_revisions.list_by_ids", async (db) => {
      if (ids.length === 0) {
        return [] as StoredSourceRecipeRevisionRecord[];
      }

      const rows = await db
        .select()
        .from(tables.sourceRecipeRevisionsTable)
        .where(inArray(tables.sourceRecipeRevisionsTable.id, [...ids]))
        .orderBy(
          asc(tables.sourceRecipeRevisionsTable.recipeId),
          asc(tables.sourceRecipeRevisionsTable.revisionNumber),
        );

      return rows.map((row) => decodeStoredSourceRecipeRevisionRecord(row));
    }),

  getById: (id: StoredSourceRecipeRevisionRecord["id"]) =>
    client.use("rows.source_recipe_revisions.get_by_id", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceRecipeRevisionsTable)
        .where(eq(tables.sourceRecipeRevisionsTable.id, id))
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeStoredSourceRecipeRevisionRecord(row.value))
        : Option.none<StoredSourceRecipeRevisionRecord>();
    }),

  getByRecipeAndMaterializationHash: (input: {
    recipeId: StoredSourceRecipeRevisionRecord["recipeId"];
    materializationHash: string;
  }) =>
    client.use("rows.source_recipe_revisions.get_by_recipe_materialization", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceRecipeRevisionsTable)
        .where(
          and(
            eq(tables.sourceRecipeRevisionsTable.recipeId, input.recipeId),
            eq(tables.sourceRecipeRevisionsTable.materializationHash, input.materializationHash),
          ),
        )
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeStoredSourceRecipeRevisionRecord(row.value))
        : Option.none<StoredSourceRecipeRevisionRecord>();
    }),

  nextRevisionNumber: (recipeId: StoredSourceRecipeRevisionRecord["recipeId"]) =>
    client.use("rows.source_recipe_revisions.next_revision_number", async (db) => {
      const rows = await db
        .select({
          revisionNumber: tables.sourceRecipeRevisionsTable.revisionNumber,
        })
        .from(tables.sourceRecipeRevisionsTable)
        .where(eq(tables.sourceRecipeRevisionsTable.recipeId, recipeId))
        .orderBy(desc(tables.sourceRecipeRevisionsTable.revisionNumber))
        .limit(1);

      return Number(rows[0]?.revisionNumber ?? 0) + 1;
    }),

  upsert: (revision: StoredSourceRecipeRevisionRecord) =>
    client.use("rows.source_recipe_revisions.upsert", async (db) => {
      await db
        .insert(tables.sourceRecipeRevisionsTable)
        .values(revision)
        .onConflictDoUpdate({
          target: [tables.sourceRecipeRevisionsTable.id],
          set: {
            ...withoutCreatedAt(revision),
          },
        });
    }),

  update: (
    id: StoredSourceRecipeRevisionRecord["id"],
    patch: RecipeRevisionPatch,
  ) =>
    client.use("rows.source_recipe_revisions.update", async (db) => {
      const rows = await db
        .update(tables.sourceRecipeRevisionsTable)
        .set(patch)
        .where(eq(tables.sourceRecipeRevisionsTable.id, id))
        .returning();

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeStoredSourceRecipeRevisionRecord(row.value))
        : Option.none<StoredSourceRecipeRevisionRecord>();
    }),

  removeByRecipeId: (recipeId: StoredSourceRecipeRevisionRecord["recipeId"]) =>
    client.use("rows.source_recipe_revisions.remove_by_recipe", async (db) => {
      const deleted = await db
        .delete(tables.sourceRecipeRevisionsTable)
        .where(eq(tables.sourceRecipeRevisionsTable.recipeId, recipeId))
        .returning();

      return deleted.length;
    }),

  removeById: (id: StoredSourceRecipeRevisionRecord["id"]) =>
    client.use("rows.source_recipe_revisions.remove_by_id", async (db) => {
      const deleted = await db
        .delete(tables.sourceRecipeRevisionsTable)
        .where(eq(tables.sourceRecipeRevisionsTable.id, id))
        .returning();

      return deleted.length > 0;
    }),
});
