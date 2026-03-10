import {
  type StoredToolArtifactParameterRecord,
  StoredToolArtifactParameterRecordSchema,
  type StoredToolArtifactRecord,
  StoredToolArtifactRecordSchema,
  type StoredToolArtifactRefHintKeyRecord,
  StoredToolArtifactRefHintKeyRecordSchema,
  type StoredToolArtifactRequestBodyContentTypeRecord,
  StoredToolArtifactRequestBodyContentTypeRecordSchema,
} from "#schema";
import * as Option from "effect/Option";
import { Schema } from "effect";
import {
  and,
  asc,
  count,
  eq,
  or,
  sql,
} from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption } from "./shared";

const decodeStoredToolArtifactRecord = Schema.decodeUnknownSync(
  StoredToolArtifactRecordSchema,
);
const decodeStoredToolArtifactParameterRecord = Schema.decodeUnknownSync(
  StoredToolArtifactParameterRecordSchema,
);
const decodeStoredToolArtifactRequestBodyContentTypeRecord = Schema.decodeUnknownSync(
  StoredToolArtifactRequestBodyContentTypeRecordSchema,
);
const decodeStoredToolArtifactRefHintKeyRecord = Schema.decodeUnknownSync(
  StoredToolArtifactRefHintKeyRecordSchema,
);

const tokenizeQuery = (value: string | undefined): string[] =>
  value
    ?.trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}_]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    ?? [];

const toTsQuery = (
  value: string | undefined,
  operator: "&" | "|",
): string | undefined => {
  const tokens = tokenizeQuery(value);
  if (tokens.length === 0) {
    return undefined;
  }

  return tokens.join(` ${operator} `);
};

const buildSearchTextClause = (
  table: DrizzleTables["toolArtifactsTable"],
  value: string | undefined,
  operator: "&" | "|",
) => {
  const tsQuery = toTsQuery(value, operator);
  return tsQuery
    ? sql`to_tsvector('simple', ${table.searchText}) @@ to_tsquery('simple', ${tsQuery})`
    : undefined;
};

const buildListWhereClause = (
  table: DrizzleTables["toolArtifactsTable"],
  input: {
    workspaceId: StoredToolArtifactRecord["workspaceId"];
    sourceId?: StoredToolArtifactRecord["sourceId"];
    namespace?: string;
    query?: string;
  },
) => {
  return and(
    eq(table.workspaceId, input.workspaceId),
    input.sourceId ? eq(table.sourceId, input.sourceId) : undefined,
    input.namespace ? eq(table.searchNamespace, input.namespace) : undefined,
    buildSearchTextClause(table, input.query, "&"),
  );
};

const buildSearchWhereClause = (
  table: DrizzleTables["toolArtifactsTable"],
  input: {
    workspaceId: StoredToolArtifactRecord["workspaceId"];
    namespace?: string;
    query: string;
  },
) => {
  if (tokenizeQuery(input.query).length === 0) {
    return and(
      eq(table.workspaceId, input.workspaceId),
      input.namespace ? eq(table.searchNamespace, input.namespace) : undefined,
      eq(table.workspaceId, "__never__"),
    );
  }

  return and(
    eq(table.workspaceId, input.workspaceId),
    input.namespace ? eq(table.searchNamespace, input.namespace) : undefined,
    buildSearchTextClause(table, input.query, "|"),
  );
};

export const createToolArtifactsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listByWorkspaceId: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    input?: {
      sourceId?: StoredToolArtifactRecord["sourceId"];
      namespace?: string;
      query?: string;
      limit?: number;
    },
  ) =>
    client.use("rows.tool_artifacts.list_by_workspace", async (db) => {
      const rows = await db
        .select()
        .from(tables.toolArtifactsTable)
        .where(
          buildListWhereClause(tables.toolArtifactsTable, {
            workspaceId,
            sourceId: input?.sourceId,
            namespace: input?.namespace,
            query: input?.query,
          }),
        )
        .orderBy(
          asc(tables.toolArtifactsTable.searchNamespace),
          asc(tables.toolArtifactsTable.path),
        )
        .limit(input?.limit ?? 200);

      return rows.map((row) => decodeStoredToolArtifactRecord(row));
    }),

  listNamespacesByWorkspaceId: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    input?: {
      limit?: number;
    },
  ) =>
    client.use("rows.tool_artifacts.list_namespaces_by_workspace", async (db) => {
      const rows = await db
        .select({
          namespace: tables.toolArtifactsTable.searchNamespace,
          toolCount: count(),
        })
        .from(tables.toolArtifactsTable)
        .where(eq(tables.toolArtifactsTable.workspaceId, workspaceId))
        .groupBy(tables.toolArtifactsTable.searchNamespace)
        .orderBy(asc(tables.toolArtifactsTable.searchNamespace))
        .limit(input?.limit ?? 200);

      return rows.map((row) => ({
        namespace: row.namespace,
        toolCount: Number(row.toolCount),
      }));
    }),

  searchByWorkspaceId: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    input: {
      namespace?: string;
      query: string;
      limit?: number;
    },
  ) =>
    client.use("rows.tool_artifacts.search_by_workspace", async (db) => {
      const baseQuery = db
        .select()
        .from(tables.toolArtifactsTable)
        .where(
          buildSearchWhereClause(tables.toolArtifactsTable, {
            workspaceId,
            namespace: input.namespace,
            query: input.query,
          }),
        )
        .orderBy(
          asc(tables.toolArtifactsTable.searchNamespace),
          asc(tables.toolArtifactsTable.path),
        );
      const rows = input.limit !== undefined
        ? await baseQuery.limit(input.limit)
        : await baseQuery;

      return rows.map((row) => decodeStoredToolArtifactRecord(row));
    }),

  getByWorkspaceAndPath: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    path: StoredToolArtifactRecord["path"],
  ) =>
    client.use("rows.tool_artifacts.get_by_workspace_and_path", async (db) => {
      const rows = await db
        .select()
        .from(tables.toolArtifactsTable)
        .where(
          and(
            eq(tables.toolArtifactsTable.workspaceId, workspaceId),
            eq(tables.toolArtifactsTable.path, path),
          ),
        )
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeStoredToolArtifactRecord(row.value))
        : Option.none<StoredToolArtifactRecord>();
    }),

  listParametersByWorkspaceAndPath: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    path: StoredToolArtifactRecord["path"],
  ) =>
    client.use("rows.tool_artifacts.list_parameters_by_workspace_and_path", async (db) => {
      const rows = await db
        .select()
        .from(tables.toolArtifactParametersTable)
        .where(
          and(
            eq(tables.toolArtifactParametersTable.workspaceId, workspaceId),
            eq(tables.toolArtifactParametersTable.path, path),
          ),
        )
        .orderBy(asc(tables.toolArtifactParametersTable.position));

      return rows.map((row) => decodeStoredToolArtifactParameterRecord(row));
    }),

  listRequestBodyContentTypesByWorkspaceAndPath: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    path: StoredToolArtifactRecord["path"],
  ) =>
    client.use(
      "rows.tool_artifacts.list_request_body_content_types_by_workspace_and_path",
      async (db) => {
        const rows = await db
          .select()
          .from(tables.toolArtifactRequestBodyContentTypesTable)
          .where(
            and(
              eq(tables.toolArtifactRequestBodyContentTypesTable.workspaceId, workspaceId),
              eq(tables.toolArtifactRequestBodyContentTypesTable.path, path),
            ),
          )
          .orderBy(asc(tables.toolArtifactRequestBodyContentTypesTable.position));

        return rows.map((row) => decodeStoredToolArtifactRequestBodyContentTypeRecord(row));
      },
    ),

  listRefHintKeysByWorkspaceAndPath: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    path: StoredToolArtifactRecord["path"],
  ) =>
    client.use("rows.tool_artifacts.list_ref_hint_keys_by_workspace_and_path", async (db) => {
      const rows = await db
        .select()
        .from(tables.toolArtifactRefHintKeysTable)
        .where(
          and(
            eq(tables.toolArtifactRefHintKeysTable.workspaceId, workspaceId),
            eq(tables.toolArtifactRefHintKeysTable.path, path),
          ),
        )
        .orderBy(asc(tables.toolArtifactRefHintKeysTable.position));

      return rows.map((row) => decodeStoredToolArtifactRefHintKeyRecord(row));
    }),

  removeByWorkspaceAndSourceId: (
    workspaceId: StoredToolArtifactRecord["workspaceId"],
    sourceId: StoredToolArtifactRecord["sourceId"],
  ) =>
    client.useTx("rows.tool_artifacts.remove_by_workspace_and_source_id", async (tx) => {
      const existingPaths = (
        await tx
          .select({
            path: tables.toolArtifactsTable.path,
          })
          .from(tables.toolArtifactsTable)
          .where(
            and(
              eq(tables.toolArtifactsTable.workspaceId, workspaceId),
              eq(tables.toolArtifactsTable.sourceId, sourceId),
            ),
          )
      ).map((row) => row.path);

      if (existingPaths.length > 0) {
        await tx
          .delete(tables.toolArtifactParametersTable)
          .where(
            and(
              eq(tables.toolArtifactParametersTable.workspaceId, workspaceId),
              or(...existingPaths.map((path) => eq(tables.toolArtifactParametersTable.path, path))),
            ),
          );
        await tx
          .delete(tables.toolArtifactRequestBodyContentTypesTable)
          .where(
            and(
              eq(tables.toolArtifactRequestBodyContentTypesTable.workspaceId, workspaceId),
              or(
                ...existingPaths.map((path) =>
                  eq(tables.toolArtifactRequestBodyContentTypesTable.path, path)
                ),
              ),
            ),
          );
        await tx
          .delete(tables.toolArtifactRefHintKeysTable)
          .where(
            and(
              eq(tables.toolArtifactRefHintKeysTable.workspaceId, workspaceId),
              or(...existingPaths.map((path) => eq(tables.toolArtifactRefHintKeysTable.path, path))),
            ),
          );
      }

      const deleted = await tx
        .delete(tables.toolArtifactsTable)
        .where(
          and(
            eq(tables.toolArtifactsTable.workspaceId, workspaceId),
            eq(tables.toolArtifactsTable.sourceId, sourceId),
          ),
        )
        .returning();

      return deleted.length;
    }),
});
