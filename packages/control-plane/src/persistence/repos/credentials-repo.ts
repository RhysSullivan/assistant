import {
  CredentialSchema,
  type Credential,
} from "#schema";
import * as Option from "effect/Option";
import { Schema } from "effect";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption } from "./shared";

const decodeCredential = Schema.decodeUnknownSync(CredentialSchema);

const credentialUpdateSet = (credential: Credential) => {
  const {
    id: _id,
    workspaceId: _workspaceId,
    sourceId: _sourceId,
    actorAccountId: _actorAccountId,
    createdAt: _createdAt,
    ...patch
  } = credential;
  return patch;
};

export const createCredentialsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listByWorkspaceId: (workspaceId: Credential["workspaceId"]) =>
    client.use("rows.credentials.list_by_workspace", async (db) => {
      const rows = await db
        .select()
        .from(tables.credentialsTable)
        .where(eq(tables.credentialsTable.workspaceId, workspaceId))
        .orderBy(
          asc(tables.credentialsTable.updatedAt),
          asc(tables.credentialsTable.id),
        );

      return rows.map((row) => decodeCredential(row));
    }),

  listByWorkspaceAndSourceId: (input: {
    workspaceId: Credential["workspaceId"];
    sourceId: Credential["sourceId"];
  }) =>
    client.use("rows.credentials.list_by_workspace_source", async (db) => {
      const rows = await db
        .select()
        .from(tables.credentialsTable)
        .where(
          and(
            eq(tables.credentialsTable.workspaceId, input.workspaceId),
            eq(tables.credentialsTable.sourceId, input.sourceId),
          ),
        )
        .orderBy(
          asc(tables.credentialsTable.updatedAt),
          asc(tables.credentialsTable.id),
        );

      return rows.map((row) => decodeCredential(row));
    }),

  listByWorkspaceSourceAndActor: (input: {
    workspaceId: Credential["workspaceId"];
    sourceId: Credential["sourceId"];
    actorAccountId: Credential["actorAccountId"];
  }) =>
    client.use("rows.credentials.list_by_workspace_source_actor", async (db) => {
      const rows = await db
        .select()
        .from(tables.credentialsTable)
        .where(
          and(
            eq(tables.credentialsTable.workspaceId, input.workspaceId),
            eq(tables.credentialsTable.sourceId, input.sourceId),
            or(
              input.actorAccountId === null
                ? isNull(tables.credentialsTable.actorAccountId)
                : eq(tables.credentialsTable.actorAccountId, input.actorAccountId),
              input.actorAccountId === null
                ? undefined
                : isNull(tables.credentialsTable.actorAccountId),
            ),
          ),
        )
        .orderBy(
          asc(tables.credentialsTable.slot),
          asc(tables.credentialsTable.actorAccountId),
          asc(tables.credentialsTable.updatedAt),
          asc(tables.credentialsTable.id),
        );

      return rows.map((row) => decodeCredential(row));
    }),

  getByWorkspaceSourceAndActor: (input: {
    workspaceId: Credential["workspaceId"];
    sourceId: Credential["sourceId"];
    actorAccountId: Credential["actorAccountId"];
    slot: Credential["slot"];
  }) =>
    client.use("rows.credentials.get_by_workspace_source_actor", async (db) => {
      const rows = await db
        .select()
        .from(tables.credentialsTable)
        .where(
          and(
            eq(tables.credentialsTable.workspaceId, input.workspaceId),
            eq(tables.credentialsTable.sourceId, input.sourceId),
            eq(tables.credentialsTable.slot, input.slot),
            input.actorAccountId === null
              ? isNull(tables.credentialsTable.actorAccountId)
              : eq(tables.credentialsTable.actorAccountId, input.actorAccountId),
          ),
        )
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeCredential(row.value))
        : Option.none<Credential>();
    }),

  upsert: (credential: Credential) =>
    client.use("rows.credentials.upsert", async (db) => {
      if (credential.actorAccountId === null) {
        const existingRows = await db
          .select({
            id: tables.credentialsTable.id,
          })
          .from(tables.credentialsTable)
          .where(
            and(
              eq(tables.credentialsTable.workspaceId, credential.workspaceId),
              eq(tables.credentialsTable.sourceId, credential.sourceId),
              eq(tables.credentialsTable.slot, credential.slot),
              isNull(tables.credentialsTable.actorAccountId),
            ),
          )
          .orderBy(
            asc(tables.credentialsTable.updatedAt),
            asc(tables.credentialsTable.id),
          );

        const existing = firstOption(existingRows);
        if (Option.isSome(existing)) {
          await db
            .update(tables.credentialsTable)
            .set(credentialUpdateSet(credential))
            .where(eq(tables.credentialsTable.id, existing.value.id));

          const duplicateIds = existingRows
            .slice(1)
            .map((row) => row.id);
          if (duplicateIds.length > 0) {
            await db
              .delete(tables.credentialsTable)
              .where(inArray(tables.credentialsTable.id, duplicateIds));
          }

          return;
        }
      }

      await db
        .insert(tables.credentialsTable)
        .values(credential)
        .onConflictDoUpdate({
          target: [
            tables.credentialsTable.workspaceId,
            tables.credentialsTable.sourceId,
            tables.credentialsTable.actorAccountId,
            tables.credentialsTable.slot,
          ],
          set: {
            ...credentialUpdateSet(credential),
          },
        });
    }),

  removeByWorkspaceSourceAndActor: (input: {
    workspaceId: Credential["workspaceId"];
    sourceId: Credential["sourceId"];
    actorAccountId: Credential["actorAccountId"];
    slot?: Credential["slot"];
  }) =>
    client.use("rows.credentials.remove_by_workspace_source_actor", async (db) => {
      const deleted = await db
        .delete(tables.credentialsTable)
        .where(
          and(
            eq(tables.credentialsTable.workspaceId, input.workspaceId),
            eq(tables.credentialsTable.sourceId, input.sourceId),
            input.slot === undefined
              ? undefined
              : eq(tables.credentialsTable.slot, input.slot),
            input.actorAccountId === null
              ? isNull(tables.credentialsTable.actorAccountId)
              : eq(tables.credentialsTable.actorAccountId, input.actorAccountId),
          ),
        )
        .returning();

      return deleted.length > 0;
    }),

  removeByWorkspaceAndSourceId: (input: {
    workspaceId: Credential["workspaceId"];
    sourceId: Credential["sourceId"];
  }) =>
    client.use("rows.credentials.remove_by_workspace_source", async (db) => {
      const deleted = await db
        .delete(tables.credentialsTable)
        .where(
          and(
            eq(tables.credentialsTable.workspaceId, input.workspaceId),
            eq(tables.credentialsTable.sourceId, input.sourceId),
          ),
        )
        .returning();

      return deleted.length;
    }),
});
