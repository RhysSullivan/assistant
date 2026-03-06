import {
  type SourceAuthSession,
  SourceAuthSessionSchema,
} from "#schema";
import * as Option from "effect/Option";
import { Schema } from "effect";
import { and, asc, eq } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption, withoutCreatedAt } from "./shared";

const decodeSourceAuthSession = Schema.decodeUnknownSync(SourceAuthSessionSchema);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type SourceAuthSessionPatch = Partial<
  Omit<Mutable<SourceAuthSession>, "id" | "workspaceId" | "sourceId" | "createdAt">
>;

export const createSourceAuthSessionsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listByWorkspaceId: (workspaceId: SourceAuthSession["workspaceId"]) =>
    client.use("rows.source_auth_sessions.list_by_workspace", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceAuthSessionsTable)
        .where(eq(tables.sourceAuthSessionsTable.workspaceId, workspaceId))
        .orderBy(asc(tables.sourceAuthSessionsTable.updatedAt), asc(tables.sourceAuthSessionsTable.id));

      return rows.map((row) => decodeSourceAuthSession(row));
    }),

  getById: (id: SourceAuthSession["id"]) =>
    client.use("rows.source_auth_sessions.get_by_id", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceAuthSessionsTable)
        .where(eq(tables.sourceAuthSessionsTable.id, id))
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeSourceAuthSession(row.value))
        : Option.none<SourceAuthSession>();
    }),

  getByState: (state: SourceAuthSession["state"]) =>
    client.use("rows.source_auth_sessions.get_by_state", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceAuthSessionsTable)
        .where(eq(tables.sourceAuthSessionsTable.state, state))
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeSourceAuthSession(row.value))
        : Option.none<SourceAuthSession>();
    }),

  getPendingByWorkspaceAndSourceId: (
    workspaceId: SourceAuthSession["workspaceId"],
    sourceId: SourceAuthSession["sourceId"],
  ) =>
    client.use("rows.source_auth_sessions.get_pending_by_workspace_and_source_id", async (db) => {
      const rows = await db
        .select()
        .from(tables.sourceAuthSessionsTable)
        .where(
          and(
            eq(tables.sourceAuthSessionsTable.workspaceId, workspaceId),
            eq(tables.sourceAuthSessionsTable.sourceId, sourceId),
            eq(tables.sourceAuthSessionsTable.status, "pending"),
          ),
        )
        .orderBy(asc(tables.sourceAuthSessionsTable.updatedAt), asc(tables.sourceAuthSessionsTable.id))
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeSourceAuthSession(row.value))
        : Option.none<SourceAuthSession>();
    }),

  insert: (session: SourceAuthSession) =>
    client.use("rows.source_auth_sessions.insert", async (db) => {
      await db.insert(tables.sourceAuthSessionsTable).values(session);
    }),

  update: (
    id: SourceAuthSession["id"],
    patch: SourceAuthSessionPatch,
  ) =>
    client.use("rows.source_auth_sessions.update", async (db) => {
      const rows = await db
        .update(tables.sourceAuthSessionsTable)
        .set(patch)
        .where(eq(tables.sourceAuthSessionsTable.id, id))
        .returning();

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeSourceAuthSession(row.value))
        : Option.none<SourceAuthSession>();
    }),

  upsert: (session: SourceAuthSession) =>
    client.use("rows.source_auth_sessions.upsert", async (db) => {
      await db
        .insert(tables.sourceAuthSessionsTable)
        .values(session)
        .onConflictDoUpdate({
          target: [tables.sourceAuthSessionsTable.id],
          set: {
            ...withoutCreatedAt(session),
          },
        });
    }),
});
