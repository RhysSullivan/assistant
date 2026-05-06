// ---------------------------------------------------------------------------
// MCP plugin storage — four tables:
//   - mcp_source: per-source structural data (transport, endpoint,
//     stdio command/args/env, etc.) plus the auth flattened into
//     columns so secret/connection refs are queryable. The non-ref
//     structural data still lives in `config` as JSON because it's
//     plugin-private and varies by transport (`remote` vs `stdio`
//     have different shapes).
//   - mcp_source_header / mcp_source_query_param: child tables for
//     remote sources' headers and query_params SecretBackedMap entries.
//   - mcp_binding: per-tool McpToolBinding (toolId/toolName/description/
//     input+output schemas/annotations). Stays JSON: it carries no
//     refs, and `inputSchema` / `outputSchema` are arbitrary
//     user-supplied JSON Schemas — a legitimate JSON case.
// OAuth session storage lives at the core level in `oauth2_session`
// and is owned by `ctx.oauth`.
// ---------------------------------------------------------------------------

import { Effect, Schema } from "effect";

import { defineSchema, type StorageDeps, type StorageFailure } from "@executor-js/sdk/core";

import {
  McpToolBinding,
  McpStoredSourceData,
  type McpConnectionAuth,
  type SecretBackedValue,
} from "./types";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const mcpSchema = defineSchema({
  mcp_source: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      // Plugin-private structural data minus the ref-bearing fields
      // (auth, headers, queryParams). For remote sources: transport,
      // endpoint, remoteTransport. For stdio: transport, command,
      // args, env, cwd.
      config: { type: "json", required: true },
      // Flattened McpConnectionAuth. Exactly one of the kind-tagged
      // groups is populated for non-`none` auths.
      auth_kind: {
        type: ["none", "header", "oauth2"],
        required: true,
        defaultValue: "none",
      },
      // Header-auth fields.
      auth_header_name: { type: "string", required: false },
      auth_secret_id: { type: "string", required: false, index: true },
      auth_secret_prefix: { type: "string", required: false },
      // OAuth2 auth fields.
      auth_connection_id: { type: "string", required: false, index: true },
      auth_client_id_secret_id: {
        type: "string",
        required: false,
        index: true,
      },
      auth_client_secret_secret_id: {
        type: "string",
        required: false,
        index: true,
      },
      created_at: { type: "date", required: true },
    },
  },
  mcp_source_header: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      source_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      kind: { type: ["text", "secret"], required: true },
      text_value: { type: "string", required: false },
      secret_id: { type: "string", required: false, index: true },
      secret_prefix: { type: "string", required: false },
    },
  },
  mcp_source_query_param: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      source_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      kind: { type: ["text", "secret"], required: true },
      text_value: { type: "string", required: false },
      secret_id: { type: "string", required: false, index: true },
      secret_prefix: { type: "string", required: false },
    },
  },
  mcp_binding: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      source_id: { type: "string", required: true, index: true },
      binding: { type: "json", required: true },
      created_at: { type: "date", required: true },
    },
  },
});

export type McpSchema = typeof mcpSchema;

// ---------------------------------------------------------------------------
// Serialization helpers — JSON columns round-trip through the adapter as
// either plain objects or serialized strings depending on the backend.
// ---------------------------------------------------------------------------

const decodeSourceData = Schema.decodeUnknownSync(McpStoredSourceData);
const encodeSourceData = Schema.encodeSync(McpStoredSourceData);

const decodeBinding = Schema.decodeUnknownSync(McpToolBinding);
const encodeBinding = Schema.encodeSync(McpToolBinding);

const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeJsonRecord = Schema.decodeUnknownSync(JsonRecord);
const decodeJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const coerceJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  return decodeJsonString(value);
};

const SourceRow = Schema.Struct({
  id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
});
const decodeSourceRow = Schema.decodeUnknownSync(SourceRow);

const ChildLookupRow = Schema.Struct({
  source_id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
});
const decodeChildLookupRow = Schema.decodeUnknownSync(ChildLookupRow);

const SecretBackedValueRow = Schema.Struct({
  name: Schema.String,
  kind: Schema.Union([Schema.Literal("text"), Schema.Literal("secret")]),
  text_value: Schema.optional(Schema.NullOr(Schema.String)),
  secret_id: Schema.optional(Schema.NullOr(Schema.String)),
  secret_prefix: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeSecretBackedValueRow = Schema.decodeUnknownSync(SecretBackedValueRow);

// --- auth column packing/unpacking ------------------------------------------

interface AuthColumns {
  readonly auth_kind: "none" | "header" | "oauth2";
  readonly auth_header_name?: string;
  readonly auth_secret_id?: string;
  readonly auth_secret_prefix?: string;
  readonly auth_connection_id?: string;
  readonly auth_client_id_secret_id?: string;
  readonly auth_client_secret_secret_id?: string;
}

const authToColumns = (auth: McpConnectionAuth): AuthColumns => {
  if (auth.kind === "header") {
    return {
      auth_kind: "header",
      auth_header_name: auth.headerName,
      auth_secret_id: auth.secretId,
      auth_secret_prefix: auth.prefix,
    };
  }
  if (auth.kind === "oauth2") {
    return {
      auth_kind: "oauth2",
      auth_connection_id: auth.connectionId,
      auth_client_id_secret_id: auth.clientIdSecretId,
      auth_client_secret_secret_id: auth.clientSecretSecretId ?? undefined,
    };
  }
  return { auth_kind: "none" };
};

const columnsToAuth = (row: Record<string, unknown>): McpConnectionAuth => {
  const kind = row.auth_kind;
  if (kind === "header" && typeof row.auth_secret_id === "string") {
    const prefix = typeof row.auth_secret_prefix === "string" ? row.auth_secret_prefix : undefined;
    return {
      kind: "header",
      headerName: typeof row.auth_header_name === "string" ? row.auth_header_name : "",
      secretId: row.auth_secret_id,
      ...(prefix ? { prefix } : {}),
    };
  }
  if (kind === "oauth2" && typeof row.auth_connection_id === "string") {
    const cid =
      typeof row.auth_client_id_secret_id === "string" ? row.auth_client_id_secret_id : undefined;
    const csec =
      typeof row.auth_client_secret_secret_id === "string"
        ? row.auth_client_secret_secret_id
        : undefined;
    return {
      kind: "oauth2",
      connectionId: row.auth_connection_id,
      ...(cid ? { clientIdSecretId: cid } : {}),
      ...(csec !== undefined && csec !== null ? { clientSecretSecretId: csec } : {}),
    };
  }
  return { kind: "none" };
};

// --- SecretBackedMap <-> child rows (mcp_source_header / query_param) -------

interface SecretBackedRow {
  readonly id: string;
  readonly scope_id: string;
  readonly source_id: string;
  readonly name: string;
  readonly kind: "text" | "secret";
  readonly text_value?: string;
  readonly secret_id?: string;
  readonly secret_prefix?: string;
  readonly [k: string]: unknown;
}

const valueMapToRows = (
  sourceId: string,
  scope: string,
  values: Record<string, SecretBackedValue> | undefined,
): readonly SecretBackedRow[] => {
  if (!values) return [];
  return Object.entries(values).map(([name, value]) => {
    const id = JSON.stringify([sourceId, name]);
    if (typeof value === "string") {
      return {
        id,
        scope_id: scope,
        source_id: sourceId,
        name,
        kind: "text",
        text_value: value,
      };
    }
    return {
      id,
      scope_id: scope,
      source_id: sourceId,
      name,
      kind: "secret",
      secret_id: value.secretId,
      secret_prefix: value.prefix,
    };
  });
};

const rowsToValueMap = (
  rows: readonly Record<string, unknown>[],
): Record<string, SecretBackedValue> => {
  const out: Record<string, SecretBackedValue> = {};
  for (const row of rows) {
    const decoded = decodeSecretBackedValueRow(row);
    if (decoded.kind === "secret" && decoded.secret_id) {
      const prefix = decoded.secret_prefix;
      const name = decoded.name;
      out[name] = prefix
        ? { secretId: decoded.secret_id, prefix }
        : { secretId: decoded.secret_id };
    } else if (decoded.kind === "text" && typeof decoded.text_value === "string") {
      out[decoded.name] = decoded.text_value;
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Stored source (decoded) — what callers see
// ---------------------------------------------------------------------------

export interface McpStoredSource {
  readonly namespace: string;
  /** Executor scope id this source row lives in. Writes stamp this on
   *  `scope_id`; reads return whichever scope's row the adapter's
   *  fall-through walk surfaced first. */
  readonly scope: string;
  readonly name: string;
  readonly config: McpStoredSourceData;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

// Every method routes through the typed adapter (`ctx.storage.adapter`)
// so the typed error channel is `StorageFailure`. Schema-decode failures
// inside `Effect.gen` land as defects, not typed errors, and are caught
// by the HTTP edge's observability middleware.
//
// Every read/write that targets a single row pins BOTH the natural id
// (namespace, toolId, sessionId) AND the owning `scope_id`. The store
// runs behind the scoped adapter (which auto-injects `scope_id IN
// (stack)`), so a bare `{id}` filter resolves to any matching row in
// the stack in adapter-iteration order. For shadowed rows (same id at
// multiple scopes — e.g. an org-level MCP source with a per-user
// override), that's a scope-isolation bug: updates and deletes can
// land on the wrong scope's row. Callers thread the resolved scope in
// (typically `path.scopeId` for HTTP, `toolRow.scope_id` /
// `input.scope` for invokeTool/lifecycle) so every keyed mutation
// targets exactly one row.
export interface McpBindingStore {
  readonly listBindingsBySource: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly toolId: string; readonly binding: McpToolBinding }>,
    StorageFailure
  >;

  readonly getBinding: (
    toolId: string,
    scope: string,
  ) => Effect.Effect<
    { readonly binding: McpToolBinding; readonly namespace: string } | null,
    StorageFailure
  >;

  readonly putBindings: (
    namespace: string,
    scope: string,
    entries: ReadonlyArray<{ readonly toolId: string; readonly binding: McpToolBinding }>,
  ) => Effect.Effect<void, StorageFailure>;

  readonly removeBindingsByNamespace: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<void, StorageFailure>;

  readonly getSource: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<McpStoredSource | null, StorageFailure>;
  readonly getSourceConfig: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<McpStoredSourceData | null, StorageFailure>;
  readonly putSource: (source: McpStoredSource) => Effect.Effect<void, StorageFailure>;
  readonly removeSource: (namespace: string, scope: string) => Effect.Effect<void, StorageFailure>;

  // ---------------------------------------------------------------------
  // Usage lookups — back `usagesForSecret` / `usagesForConnection`.
  // ---------------------------------------------------------------------

  /** Source rows whose flattened auth columns reference the given
   *  secret id. The `slot` field on each result tags which column
   *  matched so the caller can produce a precise Usage.slot. */
  readonly findSourcesBySecret: (secretId: string) => Effect.Effect<
    readonly {
      readonly namespace: string;
      readonly scope_id: string;
      readonly name: string;
      readonly slot: string;
    }[],
    StorageFailure
  >;

  /** Source rows whose oauth2 auth points at the given connection id. */
  readonly findSourcesByConnection: (connectionId: string) => Effect.Effect<
    readonly {
      readonly namespace: string;
      readonly scope_id: string;
      readonly name: string;
      readonly slot: string;
    }[],
    StorageFailure
  >;

  /** Header / query_param child rows that reference the given secret id. */
  readonly findChildRowsBySecret: (secretId: string) => Effect.Effect<
    readonly {
      readonly kind: "header" | "query_param";
      readonly source_id: string;
      readonly scope_id: string;
      readonly name: string;
    }[],
    StorageFailure
  >;

  /** Resolve display names for `(scope_id, source_id)` pairs in one
   *  round trip. Keys: `${scope_id}:${source_id}`. */
  readonly lookupSourceNames: (
    keys: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, string>, StorageFailure>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const makeMcpStore = ({ adapter: db }: StorageDeps<McpSchema>): McpBindingStore => {
  return {
    listBindingsBySource: (namespace, scope) =>
      Effect.gen(function* () {
        const rows = yield* db.findMany({
          model: "mcp_binding",
          where: [
            { field: "source_id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        return rows.map((row) => ({
          toolId: row.id,
          binding: decodeBinding(coerceJson(row.binding)),
        }));
      }),

    getBinding: (toolId, scope) =>
      Effect.gen(function* () {
        const row = yield* db.findOne({
          model: "mcp_binding",
          where: [
            { field: "id", value: toolId },
            { field: "scope_id", value: scope },
          ],
        });
        if (!row) return null;
        const binding = decodeBinding(coerceJson(row.binding));
        return { binding, namespace: row.source_id };
      }),

    putBindings: (namespace, scope, entries) =>
      Effect.gen(function* () {
        if (entries.length === 0) return;
        const now = new Date();
        yield* db.createMany({
          model: "mcp_binding",
          data: entries.map((e) => ({
            id: e.toolId,
            scope_id: scope,
            source_id: namespace,
            binding: encodeBinding(e.binding),
            created_at: now,
          })),
          forceAllowId: true,
        });
      }),

    removeBindingsByNamespace: (namespace, scope) =>
      db
        .deleteMany({
          model: "mcp_binding",
          where: [
            { field: "source_id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        })
        .pipe(Effect.asVoid),

    getSource: (namespace, scope) =>
      Effect.gen(function* () {
        const row = yield* db.findOne({
          model: "mcp_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        if (!row) return null;
        return {
          namespace: row.id,
          scope: row.scope_id,
          name: row.name,
          config: yield* hydrateSourceData(row, namespace, scope),
        };
      }),

    getSourceConfig: (namespace, scope) =>
      Effect.gen(function* () {
        const row = yield* db.findOne({
          model: "mcp_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        if (!row) return null;
        return yield* hydrateSourceData(row, namespace, scope);
      }),

    putSource: (source) =>
      Effect.gen(function* () {
        const now = new Date();
        // Drop the source row and its child rows; recreate. Two-step
        // matches the existing put-overwrites-existing semantic.
        yield* db.delete({
          model: "mcp_source",
          where: [
            { field: "id", value: source.namespace },
            { field: "scope_id", value: source.scope },
          ],
        });
        yield* deleteSourceChildren(source.namespace, source.scope);

        const auth: McpConnectionAuth =
          source.config.transport === "remote" ? source.config.auth : { kind: "none" };
        const authCols = authToColumns(auth);
        const headers = source.config.transport === "remote" ? source.config.headers : undefined;
        const queryParams =
          source.config.transport === "remote" ? source.config.queryParams : undefined;

        // The encoded config keeps every plugin-private field but
        // strips auth/headers/queryParams — those moved to columns/
        // child tables. We round-trip through encodeSourceData so the
        // remaining fields stay in the same JSON shape decode expects.
        const encodedConfig = stripExtractedFields(
          decodeJsonRecord(encodeSourceData(source.config)),
        );

        yield* db.create({
          model: "mcp_source",
          data: {
            id: source.namespace,
            scope_id: source.scope,
            name: source.name,
            config: encodedConfig,
            created_at: now,
            ...authCols,
          },
          forceAllowId: true,
        });

        const headerRows = valueMapToRows(source.namespace, source.scope, headers);
        if (headerRows.length > 0) {
          yield* db.createMany({
            model: "mcp_source_header",
            data: headerRows,
            forceAllowId: true,
          });
        }
        const paramRows = valueMapToRows(source.namespace, source.scope, queryParams);
        if (paramRows.length > 0) {
          yield* db.createMany({
            model: "mcp_source_query_param",
            data: paramRows,
            forceAllowId: true,
          });
        }
      }),

    removeSource: (namespace, scope) =>
      Effect.gen(function* () {
        yield* db.deleteMany({
          model: "mcp_binding",
          where: [
            { field: "source_id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        yield* deleteSourceChildren(namespace, scope);
        yield* db.delete({
          model: "mcp_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
      }),

    findSourcesBySecret: (secretId) =>
      Effect.gen(function* () {
        // Three places a secret id can land on an mcp_source row: the
        // header-auth secret, and the two oauth2 client_*_secret_id
        // columns. Run all three lookups in parallel and dedupe by
        // (scope_id, id).
        const [byHeader, byClientId, byClientSecret] = yield* Effect.all(
          [
            db.findMany({
              model: "mcp_source",
              where: [{ field: "auth_secret_id", value: secretId }],
            }),
            db.findMany({
              model: "mcp_source",
              where: [{ field: "auth_client_id_secret_id", value: secretId }],
            }),
            db.findMany({
              model: "mcp_source",
              where: [{ field: "auth_client_secret_secret_id", value: secretId }],
            }),
          ],
          { concurrency: "unbounded" },
        );
        const dedup = new Map<
          string,
          {
            readonly row: Record<string, unknown>;
            readonly slot: "auth.header" | "auth.oauth2.client_id" | "auth.oauth2.client_secret";
          }
        >();
        for (const r of byHeader) {
          const row = decodeSourceRow(r);
          dedup.set(`${row.scope_id}:${row.id}`, {
            row: r,
            slot: "auth.header",
          });
        }
        for (const r of byClientId) {
          const row = decodeSourceRow(r);
          dedup.set(`${row.scope_id}:${row.id}`, {
            row: r,
            slot: "auth.oauth2.client_id",
          });
        }
        for (const r of byClientSecret) {
          const row = decodeSourceRow(r);
          dedup.set(`${row.scope_id}:${row.id}`, {
            row: r,
            slot: "auth.oauth2.client_secret",
          });
        }
        return [...dedup.values()].map(({ row: rawRow, slot }) => {
          const row = decodeSourceRow(rawRow);
          return {
            namespace: row.id,
            scope_id: row.scope_id,
            name: row.name,
            slot,
          };
        });
      }),

    findSourcesByConnection: (connectionId) =>
      db
        .findMany({
          model: "mcp_source",
          where: [{ field: "auth_connection_id", value: connectionId }],
        })
        .pipe(
          Effect.map((rows) =>
            rows.map((r) => {
              const row = decodeSourceRow(r);
              return {
                namespace: row.id,
                scope_id: row.scope_id,
                name: row.name,
                slot: "auth.oauth2.connection",
              };
            }),
          ),
        ),

    findChildRowsBySecret: (secretId) =>
      Effect.gen(function* () {
        const [headers, params] = yield* Effect.all(
          [
            db.findMany({
              model: "mcp_source_header",
              where: [{ field: "secret_id", value: secretId }],
            }),
            db.findMany({
              model: "mcp_source_query_param",
              where: [{ field: "secret_id", value: secretId }],
            }),
          ],
          { concurrency: "unbounded" },
        );
        return [
          ...headers.map((r) => {
            const row = decodeChildLookupRow(r);
            return {
              kind: "header" as const,
              source_id: row.source_id,
              scope_id: row.scope_id,
              name: row.name,
            };
          }),
          ...params.map((r) => {
            const row = decodeChildLookupRow(r);
            return {
              kind: "query_param" as const,
              source_id: row.source_id,
              scope_id: row.scope_id,
              name: row.name,
            };
          }),
        ];
      }),

    lookupSourceNames: (keys) =>
      Effect.gen(function* () {
        if (keys.length === 0) return new Map<string, string>();
        const rows = yield* db.findMany({ model: "mcp_source" });
        const requested = new Set(keys);
        const out = new Map<string, string>();
        for (const r of rows) {
          const row = decodeSourceRow(r);
          const key = `${row.scope_id}:${row.id}`;
          if (requested.has(key)) out.set(key, row.name);
        }
        return out;
      }),
  };

  // ---------------------------------------------------------------------
  // Private helpers — depend on `db` so they live inside the closure.
  // ---------------------------------------------------------------------

  function deleteSourceChildren(namespace: string, scope: string) {
    return Effect.gen(function* () {
      for (const model of ["mcp_source_header", "mcp_source_query_param"] as const) {
        yield* db.deleteMany({
          model,
          where: [
            { field: "source_id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
      }
    });
  }

  function hydrateSourceData(
    row: Record<string, unknown>,
    namespace: string,
    scope: string,
  ): Effect.Effect<McpStoredSourceData, StorageFailure> {
    return Effect.gen(function* () {
      // The stored JSON has auth/headers/queryParams stripped (those
      // moved to columns / child tables). We must rehydrate the full
      // shape BEFORE handing it to the schema decoder, because
      // `McpRemoteSourceData.auth` is required.
      const partial = decodeJsonRecord(coerceJson(row.config));
      if (partial.transport !== "remote") {
        // stdio sources have no extracted fields — decode as-is.
        return decodeSourceData(partial);
      }
      const headerRows = yield* db.findMany({
        model: "mcp_source_header",
        where: [
          { field: "source_id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
      const paramRows = yield* db.findMany({
        model: "mcp_source_query_param",
        where: [
          { field: "source_id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
      const headers = rowsToValueMap(headerRows);
      const queryParams = rowsToValueMap(paramRows);
      const reassembled = {
        ...partial,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(Object.keys(queryParams).length > 0 ? { queryParams } : {}),
        auth: columnsToAuth(row),
      };
      return decodeSourceData(reassembled);
    });
  }
};

// Strip auth/headers/queryParams from the encoded source-data shape.
// Keeps the remaining structural fields (transport, endpoint, etc.) in
// the JSON config column. Per-transport: only the remote variant has
// these fields, so this is a no-op for stdio.
const stripExtractedFields = (encoded: Record<string, unknown>): Record<string, unknown> => {
  if (encoded.transport !== "remote") return encoded;
  const { auth, headers, queryParams, ...rest } = encoded;
  void auth;
  void headers;
  void queryParams;
  return rest;
};
