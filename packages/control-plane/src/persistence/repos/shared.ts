import { inArray } from "drizzle-orm";
import * as Option from "effect/Option";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";

export const firstOption = <A>(rows: ReadonlyArray<A>): Option.Option<A> =>
  rows.length > 0 ? Option.some(rows[0] as A) : Option.none<A>();

export const withoutCreatedAt = <A extends { createdAt: unknown }>(
  value: A,
): Omit<A, "createdAt"> => {
  const { createdAt: _createdAt, ...rest } = value;
  return rest;
};

const POSTGRES_SECRET_PROVIDER_ID = "postgres";

export const postgresSecretHandlesFromCredentials = (
  credentials: ReadonlyArray<{
    tokenProviderId: string;
    tokenHandle: string;
    refreshTokenProviderId: string | null;
    refreshTokenHandle: string | null;
  }>,
): ReadonlyArray<string> => {
  const handles = new Set<string>();

  for (const credential of credentials) {
    if (credential.tokenProviderId === POSTGRES_SECRET_PROVIDER_ID) {
      handles.add(credential.tokenHandle);
    }

    if (
      credential.refreshTokenProviderId === POSTGRES_SECRET_PROVIDER_ID
      && credential.refreshTokenHandle !== null
    ) {
      handles.add(credential.refreshTokenHandle);
    }
  }

  return [...handles];
};

export const chunkArray = <A>(
  values: ReadonlyArray<A>,
  chunkSize: number,
): ReadonlyArray<ReadonlyArray<A>> => {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be positive, received ${chunkSize}`);
  }

  const chunks: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
};

export const cleanupOrphanedSourceRecipes = async (input: {
  tx: Parameters<Parameters<DrizzleClient["useTx"]>[1]>[0];
  tables: DrizzleTables;
  candidateRecipeIds: ReadonlyArray<string>;
  candidateRecipeRevisionIds: ReadonlyArray<string>;
}) => {
  const recipeIds = [...new Set(input.candidateRecipeIds)];
  const recipeRevisionIds = [...new Set(input.candidateRecipeRevisionIds)];

  const remainingRevisionIds = recipeRevisionIds.length > 0
    ? (
      await input.tx
        .select({ recipeRevisionId: input.tables.sourcesTable.recipeRevisionId })
        .from(input.tables.sourcesTable)
        .where(inArray(input.tables.sourcesTable.recipeRevisionId, recipeRevisionIds))
    ).map((row) => row.recipeRevisionId)
    : [];
  const orphanRevisionIds = recipeRevisionIds.filter(
    (recipeRevisionId) => !remainingRevisionIds.includes(recipeRevisionId),
  );

  if (orphanRevisionIds.length > 0) {
    await input.tx
      .delete(input.tables.sourceRecipeDocumentsTable)
      .where(inArray(input.tables.sourceRecipeDocumentsTable.recipeRevisionId, orphanRevisionIds));
    await input.tx
      .delete(input.tables.sourceRecipeSchemaBundlesTable)
      .where(inArray(input.tables.sourceRecipeSchemaBundlesTable.recipeRevisionId, orphanRevisionIds));
    await input.tx
      .delete(input.tables.sourceRecipeOperationsTable)
      .where(inArray(input.tables.sourceRecipeOperationsTable.recipeRevisionId, orphanRevisionIds));
  }

  const remainingRecipeIds = recipeIds.length > 0
    ? (
      await input.tx
        .select({ recipeId: input.tables.sourcesTable.recipeId })
        .from(input.tables.sourcesTable)
        .where(inArray(input.tables.sourcesTable.recipeId, recipeIds))
    ).map((row) => row.recipeId)
    : [];
  const orphanRecipeIds = recipeIds.filter(
    (recipeId) => !remainingRecipeIds.includes(recipeId),
  );

  if (orphanRecipeIds.length === 0) {
    return;
  }

  const orphanRecipeRevisionIds = (
    await input.tx
      .select({ id: input.tables.sourceRecipeRevisionsTable.id })
      .from(input.tables.sourceRecipeRevisionsTable)
      .where(inArray(input.tables.sourceRecipeRevisionsTable.recipeId, orphanRecipeIds))
  ).map((revision) => revision.id);

  if (orphanRecipeRevisionIds.length > 0) {
    await input.tx
      .delete(input.tables.sourceRecipeDocumentsTable)
      .where(inArray(input.tables.sourceRecipeDocumentsTable.recipeRevisionId, orphanRecipeRevisionIds));
    await input.tx
      .delete(input.tables.sourceRecipeSchemaBundlesTable)
      .where(inArray(input.tables.sourceRecipeSchemaBundlesTable.recipeRevisionId, orphanRecipeRevisionIds));
    await input.tx
      .delete(input.tables.sourceRecipeOperationsTable)
      .where(inArray(input.tables.sourceRecipeOperationsTable.recipeRevisionId, orphanRecipeRevisionIds));
  }

  await input.tx
    .delete(input.tables.sourceRecipeRevisionsTable)
    .where(inArray(input.tables.sourceRecipeRevisionsTable.recipeId, orphanRecipeIds));
  await input.tx
    .delete(input.tables.sourceRecipesTable)
    .where(inArray(input.tables.sourceRecipesTable.id, orphanRecipeIds));
};
