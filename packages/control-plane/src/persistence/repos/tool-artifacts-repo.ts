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
  ilike,
  or,
} from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption } from "./shared";

const decodeStoredToolArtifactRecord = Schema.decodeUnknownSync(
  StoredToolArtifactRecordSchema,
);
const encodeStoredToolArtifactRecord = Schema.encodeSync(
  StoredToolArtifactRecordSchema,
);
const decodeStoredToolArtifactParameterRecord = Schema.decodeUnknownSync(
  StoredToolArtifactParameterRecordSchema,
);
const encodeStoredToolArtifactParameterRecord = Schema.encodeSync(
  StoredToolArtifactParameterRecordSchema,
);
const decodeStoredToolArtifactRequestBodyContentTypeRecord = Schema.decodeUnknownSync(
  StoredToolArtifactRequestBodyContentTypeRecordSchema,
);
const encodeStoredToolArtifactRequestBodyContentTypeRecord = Schema.encodeSync(
  StoredToolArtifactRequestBodyContentTypeRecordSchema,
);
const decodeStoredToolArtifactRefHintKeyRecord = Schema.decodeUnknownSync(
  StoredToolArtifactRefHintKeyRecordSchema,
);
const encodeStoredToolArtifactRefHintKeyRecord = Schema.encodeSync(
  StoredToolArtifactRefHintKeyRecordSchema,
);

type ReplaceableToolArtifactRecord = {
  artifact: StoredToolArtifactRecord;
  parameters?: readonly StoredToolArtifactParameterRecord[];
  requestBodyContentTypes?: readonly StoredToolArtifactRequestBodyContentTypeRecord[];
  refHintKeys?: readonly StoredToolArtifactRefHintKeyRecord[];
};

const tokenizeQuery = (value: string | undefined): string[] =>
  value
    ?.trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    ?? [];

const likePattern = (token: string): string =>
  `%${token.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

const buildListWhereClause = (
  table: DrizzleTables["toolArtifactsTable"],
  input: {
    workspaceId: StoredToolArtifactRecord["workspaceId"];
    sourceId?: StoredToolArtifactRecord["sourceId"];
    namespace?: string;
    query?: string;
  },
) => {
  const queryTokens = tokenizeQuery(input.query);

  return and(
    eq(table.workspaceId, input.workspaceId),
    input.sourceId ? eq(table.sourceId, input.sourceId) : undefined,
    input.namespace ? eq(table.searchNamespace, input.namespace) : undefined,
    ...queryTokens.map((token) =>
      ilike(table.searchText, likePattern(token)),
    ),
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
  const queryTokens = tokenizeQuery(input.query);
  if (queryTokens.length === 0) {
    return and(
      eq(table.workspaceId, input.workspaceId),
      input.namespace ? eq(table.searchNamespace, input.namespace) : undefined,
      eq(table.workspaceId, "__never__"),
    );
  }

  return and(
    eq(table.workspaceId, input.workspaceId),
    input.namespace ? eq(table.searchNamespace, input.namespace) : undefined,
    or(...queryTokens.map((token) => ilike(table.searchText, likePattern(token)))),
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

  replaceForSource: (input: {
    workspaceId: StoredToolArtifactRecord["workspaceId"];
    sourceId: StoredToolArtifactRecord["sourceId"];
    artifacts: readonly ReplaceableToolArtifactRecord[];
  }) =>
    client.useTx("rows.tool_artifacts.replace_for_source", async (tx) => {
      const existingPaths = (
        await tx
          .select({
            path: tables.toolArtifactsTable.path,
          })
          .from(tables.toolArtifactsTable)
          .where(
            and(
              eq(tables.toolArtifactsTable.workspaceId, input.workspaceId),
              eq(tables.toolArtifactsTable.sourceId, input.sourceId),
            ),
          )
      ).map((row) => row.path);

      if (existingPaths.length > 0) {
        await tx
          .delete(tables.toolArtifactParametersTable)
          .where(
            and(
              eq(tables.toolArtifactParametersTable.workspaceId, input.workspaceId),
              or(...existingPaths.map((path) => eq(tables.toolArtifactParametersTable.path, path))),
            ),
          );
        await tx
          .delete(tables.toolArtifactRequestBodyContentTypesTable)
          .where(
            and(
              eq(
                tables.toolArtifactRequestBodyContentTypesTable.workspaceId,
                input.workspaceId,
              ),
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
              eq(tables.toolArtifactRefHintKeysTable.workspaceId, input.workspaceId),
              or(...existingPaths.map((path) => eq(tables.toolArtifactRefHintKeysTable.path, path))),
            ),
          );
      }

      await tx
        .delete(tables.toolArtifactsTable)
        .where(
          and(
            eq(tables.toolArtifactsTable.workspaceId, input.workspaceId),
            eq(tables.toolArtifactsTable.sourceId, input.sourceId),
          ),
        );

      if (input.artifacts.length === 0) {
        return;
      }

      await tx.insert(tables.toolArtifactsTable).values(
        input.artifacts.map(({ artifact }) => encodeStoredToolArtifactRecord(artifact)),
      );

      const parameterRows = input.artifacts.flatMap(({ parameters = [] }) => parameters);
      if (parameterRows.length > 0) {
        await tx.insert(tables.toolArtifactParametersTable).values(
          parameterRows.map((record) => encodeStoredToolArtifactParameterRecord(record)),
        );
      }

      const requestBodyContentTypeRows = input.artifacts.flatMap(
        ({ requestBodyContentTypes = [] }) => requestBodyContentTypes,
      );
      if (requestBodyContentTypeRows.length > 0) {
        await tx.insert(tables.toolArtifactRequestBodyContentTypesTable).values(
          requestBodyContentTypeRows.map((record) =>
            encodeStoredToolArtifactRequestBodyContentTypeRecord(record)
          ),
        );
      }

      const refHintKeyRows = input.artifacts.flatMap(({ refHintKeys = [] }) => refHintKeys);
      if (refHintKeyRows.length > 0) {
        await tx.insert(tables.toolArtifactRefHintKeysTable).values(
          refHintKeyRows.map((record) => encodeStoredToolArtifactRefHintKeyRecord(record)),
        );
      }
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
