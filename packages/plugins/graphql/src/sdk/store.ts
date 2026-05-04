import { Effect } from "effect";

import {
  defineSchema,
  type StorageDeps,
  type StorageFailure,
} from "@executor-js/sdk/core";

import {
  OperationBinding,
  type GraphqlSourceAuth,
  type HeaderValue,
  type QueryParamValue,
} from "./types";

// ---------------------------------------------------------------------------
// Schema — four tables:
//   - graphql_source: endpoint + auth + display name per source. Auth is
//     flattened (kind enum + nullable connection_id) so the
//     `usagesForConnection` query is one indexed SELECT.
//   - graphql_source_header / graphql_source_query_param: one row per
//     header/param entry. `kind` discriminates literal text from a
//     secret reference; `secret_id` is indexed so `usagesForSecret`
//     reads the index directly. PK is `(scope_id, id)` where id is a
//     JSON tuple `[source_id,name]` so user-provided separators cannot
//     collide.
//   - graphql_operation: per-tool OperationBinding blob. Operation
//     bindings don't reference secrets/connections, so they stay as
//     JSON — that's a legit JSON case (the binding shape is plugin-
//     internal opaque data).
// ---------------------------------------------------------------------------

export const graphqlSchema = defineSchema({
  graphql_source: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      endpoint: { type: "string", required: true },
      auth_kind: {
        type: ["none", "oauth2"],
        required: true,
        defaultValue: "none",
      },
      auth_connection_id: {
        type: "string",
        required: false,
        index: true,
      },
    },
  },
  graphql_source_header: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      source_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      kind: {
        type: ["text", "secret"],
        required: true,
      },
      text_value: { type: "string", required: false },
      secret_id: { type: "string", required: false, index: true },
      secret_prefix: { type: "string", required: false },
    },
  },
  graphql_source_query_param: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      source_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      kind: {
        type: ["text", "secret"],
        required: true,
      },
      text_value: { type: "string", required: false },
      secret_id: { type: "string", required: false, index: true },
      secret_prefix: { type: "string", required: false },
    },
  },
  graphql_operation: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      source_id: { type: "string", required: true, index: true },
      binding: { type: "json", required: true },
    },
  },
});

export type GraphqlSchema = typeof graphqlSchema;

// ---------------------------------------------------------------------------
// In-memory value shapes
// ---------------------------------------------------------------------------

export interface StoredGraphqlSource {
  readonly namespace: string;
  /** Executor scope id this source row lives in. Writes stamp this on
   *  `scope_id`; reads return whichever scope's row the adapter's
   *  fall-through walk surfaced first. */
  readonly scope: string;
  readonly name: string;
  readonly endpoint: string;
  readonly headers: Record<string, HeaderValue>;
  readonly queryParams: Record<string, QueryParamValue>;
  readonly auth: GraphqlSourceAuth;
}

export interface StoredOperation {
  readonly toolId: string;
  readonly sourceId: string;
  readonly binding: OperationBinding;
}

// Persisted JSON shape for an OperationBinding. Reconstructed into a
// Schema.Class instance on read.
interface BindingJson {
  readonly kind: "query" | "mutation";
  readonly fieldName: string;
  readonly operationString: string;
  readonly variableNames: readonly string[];
}

const decodeBinding = (value: unknown): OperationBinding => {
  const data =
    typeof value === "string"
      ? (JSON.parse(value) as BindingJson)
      : (value as BindingJson);
  return new OperationBinding({
    kind: data.kind,
    fieldName: data.fieldName,
    operationString: data.operationString,
    variableNames: [...data.variableNames],
  });
};

const encodeBinding = (binding: OperationBinding): BindingJson => ({
  kind: binding.kind,
  fieldName: binding.fieldName,
  operationString: binding.operationString,
  variableNames: [...binding.variableNames],
});

const toJsonRecord = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

// Header / query-param rows: collapse the flat columns back into a
// `SecretBackedValue` map keyed by header name. `kind` discriminates the
// shape; `secret_prefix` is optional and only populated when present in
// the original config.
const rowsToValueMap = (
  rows: readonly Record<string, unknown>[],
): Record<string, HeaderValue> => {
  const out: Record<string, HeaderValue> = {};
  for (const row of rows) {
    const name = row.name as string;
    if (row.kind === "secret" && typeof row.secret_id === "string") {
      const prefix = row.secret_prefix as string | undefined | null;
      out[name] = prefix
        ? { secretId: row.secret_id, prefix }
        : { secretId: row.secret_id };
    } else if (row.kind === "text" && typeof row.text_value === "string") {
      out[name] = row.text_value;
    }
  }
  return out;
};

// Encode one entry of a SecretBackedValue map into a child row. Used by
// the writer for both `graphql_source_header` and
// `graphql_source_query_param`. Returns a `Record<string, unknown>` so
// the result is structurally assignable to the typed adapter's
// `RowInput` shape (which has its own index signature).
const valueToChildRow = (
  sourceId: string,
  scope: string,
  name: string,
  value: HeaderValue,
): Record<string, unknown> => {
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
};

const rowToAuth = (row: Record<string, unknown>): GraphqlSourceAuth => {
  if (
    row.auth_kind === "oauth2" &&
    typeof row.auth_connection_id === "string"
  ) {
    return { kind: "oauth2", connectionId: row.auth_connection_id };
  }
  return { kind: "none" };
};

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

// Every read/write that targets a single row pins BOTH the natural id
// (namespace, toolId) AND the owning `scope_id`. The store runs behind
// the scoped adapter (which auto-injects `scope_id IN (stack)`), so a
// bare `{id}` filter resolves to any matching row in the stack in
// adapter-iteration order. For shadowed rows (same id at multiple
// scopes — e.g. an org-level GraphQL source with a per-user override),
// that's a scope-isolation bug: updates and deletes can land on the
// wrong scope's row. Callers thread the resolved scope in (typically
// `path.scopeId` for HTTP, `toolRow.scope_id` / `input.scope` for
// invokeTool/lifecycle) so every keyed mutation targets exactly one
// row.
/** Flat row shape returned by the usage-lookup helpers. Mirrors the new
 *  child-table columns so callers can build a `Usage` without
 *  re-decoding. */
export interface ChildUsageRow {
  readonly source_id: string;
  readonly scope_id: string;
  readonly name: string;
}

export interface GraphqlStore {
  readonly upsertSource: (
    input: StoredGraphqlSource,
    operations: readonly StoredOperation[],
  ) => Effect.Effect<void, StorageFailure>;

  readonly updateSourceMeta: (
    namespace: string,
    scope: string,
    patch: {
      readonly name?: string;
      readonly endpoint?: string;
      readonly headers?: Record<string, HeaderValue>;
      readonly queryParams?: Record<string, QueryParamValue>;
      readonly auth?: GraphqlSourceAuth;
    },
  ) => Effect.Effect<void, StorageFailure>;

  readonly getSource: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<StoredGraphqlSource | null, StorageFailure>;

  readonly listSources: () => Effect.Effect<
    readonly StoredGraphqlSource[],
    StorageFailure
  >;

  readonly getOperationByToolId: (
    toolId: string,
    scope: string,
  ) => Effect.Effect<StoredOperation | null, StorageFailure>;

  readonly listOperationsBySource: (
    sourceId: string,
    scope: string,
  ) => Effect.Effect<readonly StoredOperation[], StorageFailure>;

  readonly removeSource: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<void, StorageFailure>;

  // ---------------------------------------------------------------------
  // Usage lookups — power `usagesForSecret` / `usagesForConnection`.
  // Each is one indexed SELECT against the new normalized columns.
  // ---------------------------------------------------------------------

  /** Header rows that reference the given secret id, across every scope
   *  visible to the executor. */
  readonly findHeaderRowsBySecret: (
    secretId: string,
  ) => Effect.Effect<readonly ChildUsageRow[], StorageFailure>;

  /** Query-param rows that reference the given secret id. */
  readonly findQueryParamRowsBySecret: (
    secretId: string,
  ) => Effect.Effect<readonly ChildUsageRow[], StorageFailure>;

  /** Source rows whose oauth2 auth points at the given connection id. */
  readonly findSourcesByConnection: (
    connectionId: string,
  ) => Effect.Effect<readonly StoredGraphqlSource[], StorageFailure>;

  /** Resolve the display name for one or more `(scope_id, source_id)`
   *  pairs in a single round trip. Returned map is keyed by
   *  `${scope_id}:${source_id}`; missing entries are simply absent. */
  readonly lookupSourceNames: (
    keys: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, string>, StorageFailure>;
}

// ---------------------------------------------------------------------------
// Default store implementation
// ---------------------------------------------------------------------------

export const makeDefaultGraphqlStore = ({
  adapter: db,
}: StorageDeps<GraphqlSchema>): GraphqlStore => {
  const loadHeaders = (sourceId: string, scope: string) =>
    db
      .findMany({
        model: "graphql_source_header",
        where: [
          { field: "source_id", value: sourceId },
          { field: "scope_id", value: scope },
        ],
      })
      .pipe(Effect.map(rowsToValueMap));

  const loadQueryParams = (sourceId: string, scope: string) =>
    db
      .findMany({
        model: "graphql_source_query_param",
        where: [
          { field: "source_id", value: sourceId },
          { field: "scope_id", value: scope },
        ],
      })
      .pipe(Effect.map(rowsToValueMap));

  const rowToSourceWithChildren = (
    row: Record<string, unknown>,
  ): Effect.Effect<StoredGraphqlSource, StorageFailure> =>
    Effect.gen(function* () {
      const sourceId = row.id as string;
      const scope = row.scope_id as string;
      const headers = yield* loadHeaders(sourceId, scope);
      const queryParams = yield* loadQueryParams(sourceId, scope);
      return {
        namespace: sourceId,
        scope,
        name: row.name as string,
        endpoint: row.endpoint as string,
        headers,
        queryParams,
        auth: rowToAuth(row),
      };
    });

  const rowToOperation = (row: Record<string, unknown>): StoredOperation => ({
    toolId: row.id as string,
    sourceId: row.source_id as string,
    binding: decodeBinding(row.binding),
  });

  // Replace child rows for a source by deleting then bulk-inserting. Used
  // by both upsertSource (full rewrite) and updateSourceMeta (partial
  // patch when headers/queryParams is supplied).
  const replaceChildren = (
    model: "graphql_source_header" | "graphql_source_query_param",
    sourceId: string,
    scope: string,
    values: Record<string, HeaderValue>,
  ) =>
    Effect.gen(function* () {
      yield* db.deleteMany({
        model,
        where: [
          { field: "source_id", value: sourceId },
          { field: "scope_id", value: scope },
        ],
      });
      const entries = Object.entries(values);
      if (entries.length === 0) return;
      yield* db.createMany({
        model,
        data: entries.map(([name, value]) =>
          valueToChildRow(sourceId, scope, name, value),
        ),
        forceAllowId: true,
      });
    });

  const deleteSource = (namespace: string, scope: string) =>
    Effect.gen(function* () {
      yield* db.deleteMany({
        model: "graphql_operation",
        where: [
          { field: "source_id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
      yield* db.deleteMany({
        model: "graphql_source_header",
        where: [
          { field: "source_id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
      yield* db.deleteMany({
        model: "graphql_source_query_param",
        where: [
          { field: "source_id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
      yield* db.delete({
        model: "graphql_source",
        where: [
          { field: "id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
    });

  return {
    upsertSource: (input, operations) =>
      Effect.gen(function* () {
        yield* deleteSource(input.namespace, input.scope);
        yield* db.create({
          model: "graphql_source",
          data: {
            id: input.namespace,
            scope_id: input.scope,
            name: input.name,
            endpoint: input.endpoint,
            auth_kind: input.auth.kind,
            auth_connection_id:
              input.auth.kind === "oauth2" ? input.auth.connectionId : undefined,
          },
          forceAllowId: true,
        });
        yield* replaceChildren(
          "graphql_source_header",
          input.namespace,
          input.scope,
          input.headers,
        );
        yield* replaceChildren(
          "graphql_source_query_param",
          input.namespace,
          input.scope,
          input.queryParams,
        );
        if (operations.length > 0) {
          yield* db.createMany({
            model: "graphql_operation",
            data: operations.map((op) => ({
              id: op.toolId,
              scope_id: input.scope,
              source_id: op.sourceId,
              binding: toJsonRecord(encodeBinding(op.binding)),
            })),
            forceAllowId: true,
          });
        }
      }),

    updateSourceMeta: (namespace, scope, patch) =>
      Effect.gen(function* () {
        const existing = yield* db.findOne({
          model: "graphql_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        if (!existing) return;
        const update: Record<string, unknown> = {};
        if (patch.name !== undefined) update.name = patch.name;
        if (patch.endpoint !== undefined) update.endpoint = patch.endpoint;
        if (patch.auth !== undefined) {
          update.auth_kind = patch.auth.kind;
          update.auth_connection_id =
            patch.auth.kind === "oauth2" ? patch.auth.connectionId : null;
        }
        if (Object.keys(update).length > 0) {
          yield* db.update({
            model: "graphql_source",
            where: [
              { field: "id", value: namespace },
              { field: "scope_id", value: scope },
            ],
            update,
          });
        }
        if (patch.headers !== undefined) {
          yield* replaceChildren(
            "graphql_source_header",
            namespace,
            scope,
            patch.headers,
          );
        }
        if (patch.queryParams !== undefined) {
          yield* replaceChildren(
            "graphql_source_query_param",
            namespace,
            scope,
            patch.queryParams,
          );
        }
      }),

    getSource: (namespace, scope) =>
      Effect.gen(function* () {
        const row = yield* db.findOne({
          model: "graphql_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        if (!row) return null;
        return yield* rowToSourceWithChildren(row);
      }),

    listSources: () =>
      Effect.gen(function* () {
        const rows = yield* db.findMany({ model: "graphql_source" });
        return yield* Effect.forEach(rows, rowToSourceWithChildren, {
          concurrency: "unbounded",
        });
      }),

    getOperationByToolId: (toolId, scope) =>
      db
        .findOne({
          model: "graphql_operation",
          where: [
            { field: "id", value: toolId },
            { field: "scope_id", value: scope },
          ],
        })
        .pipe(Effect.map((row) => (row ? rowToOperation(row) : null))),

    listOperationsBySource: (sourceId, scope) =>
      db
        .findMany({
          model: "graphql_operation",
          where: [
            { field: "source_id", value: sourceId },
            { field: "scope_id", value: scope },
          ],
        })
        .pipe(Effect.map((rows) => rows.map(rowToOperation))),

    removeSource: (namespace, scope) => deleteSource(namespace, scope),

    findHeaderRowsBySecret: (secretId) =>
      db
        .findMany({
          model: "graphql_source_header",
          where: [{ field: "secret_id", value: secretId }],
        })
        .pipe(
          Effect.map((rows) =>
            rows.map(
              (r): ChildUsageRow => ({
                source_id: r.source_id as string,
                scope_id: r.scope_id as string,
                name: r.name as string,
              }),
            ),
          ),
        ),

    findQueryParamRowsBySecret: (secretId) =>
      db
        .findMany({
          model: "graphql_source_query_param",
          where: [{ field: "secret_id", value: secretId }],
        })
        .pipe(
          Effect.map((rows) =>
            rows.map(
              (r): ChildUsageRow => ({
                source_id: r.source_id as string,
                scope_id: r.scope_id as string,
                name: r.name as string,
              }),
            ),
          ),
        ),

    findSourcesByConnection: (connectionId) =>
      Effect.gen(function* () {
        const rows = yield* db.findMany({
          model: "graphql_source",
          where: [
            { field: "auth_connection_id", value: connectionId },
          ],
        });
        // Skip the children load — usage callers only need the parent
        // row's name + scope. Synthesize a minimal StoredGraphqlSource
        // shape with empty headers/params so the type matches without
        // a wasted child fetch.
        return rows.map(
          (row): StoredGraphqlSource => ({
            namespace: row.id as string,
            scope: row.scope_id as string,
            name: row.name as string,
            endpoint: row.endpoint as string,
            headers: {},
            queryParams: {},
            auth: rowToAuth(row),
          }),
        );
      }),

    lookupSourceNames: (keys) =>
      Effect.gen(function* () {
        if (keys.length === 0) return new Map<string, string>();
        // Pull every source the executor's scope walk surfaces, then
        // index by composite key. Cheaper than per-key findOne and the
        // graphql source table is small in practice (one row per
        // endpoint).
        const rows = yield* db.findMany({ model: "graphql_source" });
        const requested = new Set(keys);
        const out = new Map<string, string>();
        for (const r of rows) {
          const key = `${r.scope_id as string}:${r.id as string}`;
          if (requested.has(key)) out.set(key, r.name as string);
        }
        return out;
      }),
  };
};
