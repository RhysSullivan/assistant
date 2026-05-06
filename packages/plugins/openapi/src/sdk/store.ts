import { Effect, Schema } from "effect";

import {
  ConnectionId,
  defineSchema,
  ScopeId,
  SecretId,
  StorageError,
  type StorageDeps,
  type StorageFailure,
} from "@executor-js/sdk/core";

import {
  ConfiguredHeaderValue,
  ConfiguredHeaderBinding,
  HeaderValue,
  OAuth2Auth,
  OAuth2SourceConfig,
  OpenApiSourceBindingInput,
  OpenApiSourceBindingRef,
  OpenApiSourceBindingValue,
  OperationBinding,
} from "./types";

// ---------------------------------------------------------------------------
// Schema — three tables:
//   - openapi_source: one row per onboarded spec (baseUrl, headers, oauth2, ...)
//   - openapi_operation: one row per operation binding keyed by tool id
//   - openapi_source_binding: credential bindings for shared sources
// ---------------------------------------------------------------------------

// Each of the secret-backed child tables (`openapi_source_query_param`,
// `openapi_source_spec_fetch_header`,
// `openapi_source_spec_fetch_query_param`) shares the same column shape:
// id/scope_id/source_id/name plus a `kind` enum that discriminates a
// literal text value from a secret reference (with optional prefix).
// The fields are inlined per-table because `defineSchema`'s type
// narrowing relies on the literal types staying on the original
// declaration site.

export const openapiSchema = defineSchema({
  openapi_source: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      spec: { type: "string", required: true },
      // Origin URL the spec was fetched from. Set when `addSpec` was
      // invoked with an http(s) URL; null when the caller passed raw
      // spec text. Drives `canRefresh` on the core source row and
      // is the address re-fetched on `refreshSource`.
      source_url: { type: "string", required: false },
      base_url: { type: "string", required: false },
      // `headers` and `oauth2` stay JSON: these carry slot names, not
      // direct secret/connection ids. The secrets/connections that
      // actually power them live one level of indirection deeper, in
      // `openapi_source_binding` rows keyed by slot — and those ARE
      // normalized below. Headers and oauth2 are plugin-private
      // structural data, not cross-cutting refs.
      headers: { type: "json", required: false },
      oauth2: { type: "json", required: false },
    },
  },
  openapi_operation: {
    fields: {
      id: { type: "string", required: true },
      scope_id: { type: "string", required: true, index: true },
      source_id: { type: "string", required: true, index: true },
      binding: { type: "json", required: true },
    },
  },
  openapi_source_binding: {
    fields: {
      id: { type: "string", required: true },
      source_id: { type: "string", required: true, index: true },
      source_scope_id: { type: "string", required: true, index: true },
      // Intentionally NOT named `scope_id`: this row is visible across
      // scope stacks and is filtered manually by source/target scope.
      // The target scope is credential ownership data, not adapter row
      // ownership. Source owners must be able to delete all descendant
      // bindings when a shared source is removed.
      target_scope_id: { type: "string", required: true, index: true },
      slot: { type: "string", required: true, index: true },
      // Discriminated union, flattened. Exactly one of secret_id /
      // connection_id / text_value is populated based on `kind`.
      // `secret_id` and `connection_id` are indexed so usages queries
      // are one-hop SELECTs.
      kind: { type: ["secret", "connection", "text"], required: true },
      secret_id: { type: "string", required: false, index: true },
      connection_id: { type: "string", required: false, index: true },
      text_value: { type: "string", required: false },
      created_at: { type: "date", required: true },
      updated_at: { type: "date", required: true },
    },
  },
  openapi_source_query_param: {
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
  openapi_source_spec_fetch_header: {
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
  openapi_source_spec_fetch_query_param: {
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
});

export type OpenapiSchema = typeof openapiSchema;

// ---------------------------------------------------------------------------
// In-memory shapes
// ---------------------------------------------------------------------------

export interface SourceConfig {
  readonly spec: string;
  /** Origin URL when the spec was fetched from http(s). Absent for
   *  raw-text adds. Persisted so `refreshSource` can re-fetch. */
  readonly sourceUrl?: string;
  readonly baseUrl?: string;
  readonly namespace?: string;
  readonly headers?: Record<string, ConfiguredHeaderValue>;
  readonly queryParams?: Record<string, HeaderValue>;
  readonly specFetchCredentials?: OpenApiSpecFetchCredentials;
  readonly oauth2?: OAuth2SourceConfig;
}

export interface OpenApiSpecFetchCredentials {
  readonly headers?: Record<string, HeaderValue>;
  readonly queryParams?: Record<string, HeaderValue>;
}

export interface StoredSource {
  readonly namespace: string;
  /** Executor scope id this source row lives in. Writes stamp this on
   *  `scope_id`; reads return whichever scope's row the adapter's
   *  fall-through filter sees first. */
  readonly scope: string;
  readonly name: string;
  readonly config: SourceConfig;
  readonly legacy?: {
    readonly headers?: Record<string, HeaderValue>;
    readonly oauth2?: OAuth2Auth;
  };
}

// ---------------------------------------------------------------------------
// Schema-class mirror of StoredSource for the API layer, where we need
// an encodable/decodable shape for HTTP responses.
// ---------------------------------------------------------------------------

export class StoredSourceSchema extends Schema.Class<StoredSourceSchema>("OpenApiStoredSource")({
  namespace: Schema.String,
  name: Schema.String,
  config: Schema.Struct({
    spec: Schema.String,
    sourceUrl: Schema.optional(Schema.String),
    baseUrl: Schema.optional(Schema.String),
    namespace: Schema.optional(Schema.String),
    headers: Schema.optional(Schema.Record(Schema.String, ConfiguredHeaderValue)),
    queryParams: Schema.optional(Schema.Record(Schema.String, HeaderValue)),
    specFetchCredentials: Schema.optional(
      Schema.Struct({
        headers: Schema.optional(Schema.Record(Schema.String, HeaderValue)),
        queryParams: Schema.optional(Schema.Record(Schema.String, HeaderValue)),
      }),
    ),
    // Canonical source-owned OAuth config. Concrete client credentials
    // and connection ids live in OpenAPI-owned scoped binding rows.
    oauth2: Schema.optional(OAuth2SourceConfig),
  }),
}) {}

export type StoredSourceSchemaType = typeof StoredSourceSchema.Type;

export interface StoredOperation {
  readonly toolId: string;
  readonly sourceId: string;
  readonly binding: OperationBinding;
}

// ---------------------------------------------------------------------------
// Schema encode/decode — OperationBinding has Option fields, so we must use
// Schema.encode/decode rather than plain JSON to round-trip correctly.
// ---------------------------------------------------------------------------

const encodeBinding = Schema.encodeSync(OperationBinding);

const encodeOAuth2SourceConfig = Schema.encodeSync(OAuth2SourceConfig);

const ConfiguredHeaderValueMap = Schema.Record(Schema.String, ConfiguredHeaderValue);
const StoredHeaderValueMap = Schema.Record(
  Schema.String,
  Schema.Union([HeaderValue, ConfiguredHeaderBinding]),
);
const JsonStoredHeaderValueMap = Schema.fromJsonString(StoredHeaderValueMap);
const JsonOAuth2Auth = Schema.fromJsonString(OAuth2Auth);
const JsonOAuth2SourceConfig = Schema.fromJsonString(OAuth2SourceConfig);
const JsonOperationBinding = Schema.fromJsonString(OperationBinding);

const ChildRowSchema = Schema.Struct({
  id: Schema.String,
  scope_id: Schema.String,
  source_id: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["text", "secret"]),
  text_value: Schema.optional(Schema.String),
  secret_id: Schema.optional(Schema.String),
  secret_prefix: Schema.optional(Schema.String),
});

const OpenApiSourceRowSchema = Schema.Struct({
  id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
  spec: Schema.String,
  source_url: Schema.optional(Schema.NullOr(Schema.String)),
  base_url: Schema.optional(Schema.NullOr(Schema.String)),
  headers: Schema.optional(Schema.Unknown),
  oauth2: Schema.optional(Schema.Unknown),
});

const OpenApiOperationRowSchema = Schema.Struct({
  id: Schema.String,
  source_id: Schema.String,
  binding: Schema.Unknown,
});

const OpenApiSourceBindingRowSchema = Schema.Struct({
  source_id: Schema.String,
  source_scope_id: Schema.String,
  target_scope_id: Schema.String,
  slot: Schema.String,
  kind: Schema.Literals(["secret", "connection", "text"]),
  secret_id: Schema.optional(Schema.String),
  connection_id: Schema.optional(Schema.String),
  text_value: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.Union([Schema.Date, Schema.DateFromString]),
  updated_at: Schema.Union([Schema.Date, Schema.DateFromString]),
});

const SourceChildUsageRowSchema = Schema.Struct({
  source_id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
});

const SourceNameRowSchema = Schema.Struct({
  id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
});

const isConfiguredHeaderBinding = Schema.is(ConfiguredHeaderBinding);

type DecodedChildRow = typeof ChildRowSchema.Type;
// Index signature satisfies the adapter's `RowInput` shape; field types come
// from the schema above.
type ChildRow = DecodedChildRow & Record<string, unknown>;

// Collapse a SecretBackedValue map into the flat child-table column
// shape used by openapi_source_query_param and the two
// openapi_source_spec_fetch_* tables. Returns one record per entry.
const valueMapToChildRows = (
  sourceId: string,
  scope: string,
  values: Record<string, HeaderValue> | undefined,
): readonly ChildRow[] => {
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

const childRowsToValueMap = (
  rows: readonly Record<string, unknown>[],
): Effect.Effect<Record<string, HeaderValue>, StorageFailure> =>
  Effect.gen(function* () {
    const decodedRows = yield* Schema.decodeUnknownEffect(Schema.Array(ChildRowSchema))(rows).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            message: "Failed to decode OpenAPI source child rows",
            cause,
          }),
      ),
    );
    const out: Record<string, HeaderValue> = {};
    for (const row of decodedRows) {
      if (row.kind === "secret" && row.secret_id !== undefined) {
        out[row.name] =
          row.secret_prefix !== undefined
            ? { secretId: row.secret_id, prefix: row.secret_prefix }
            : { secretId: row.secret_id };
      } else if (row.kind === "text" && row.text_value !== undefined) {
        out[row.name] = row.text_value;
      }
    }
    return out;
  });

const toJsonRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

const decodeHeaders = (
  value: unknown,
): Effect.Effect<Record<string, HeaderValue | ConfiguredHeaderBinding>, StorageFailure> => {
  if (value == null) return Effect.succeed({});
  return Schema.decodeUnknownEffect(
    typeof value === "string" ? JsonStoredHeaderValueMap : StoredHeaderValueMap,
  )(value).pipe(
    Effect.mapError(
      (cause) =>
        new StorageError({
          message: "Failed to decode OpenAPI source headers",
          cause,
        }),
    ),
  );
};

const slugifySlotPart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";

export const headerBindingSlot = (headerName: string): string =>
  `header:${slugifySlotPart(headerName)}`;

export const oauth2ClientIdSlot = (securitySchemeName: string): string =>
  `oauth2:${slugifySlotPart(securitySchemeName)}:client-id`;

export const oauth2ClientSecretSlot = (securitySchemeName: string): string =>
  `oauth2:${slugifySlotPart(securitySchemeName)}:client-secret`;

export const oauth2ConnectionSlot = (securitySchemeName: string): string =>
  `oauth2:${slugifySlotPart(securitySchemeName)}:connection`;

const normalizeStoredHeaders = (
  value: unknown,
): Effect.Effect<
  {
    readonly headers: Record<string, ConfiguredHeaderValue>;
    readonly legacy: Record<string, HeaderValue>;
  },
  StorageFailure
> =>
  Effect.gen(function* () {
    const raw = yield* decodeHeaders(value);
    const headers: Record<string, ConfiguredHeaderValue> = {};
    const legacy: Record<string, HeaderValue> = {};
    for (const [name, header] of Object.entries(raw)) {
      if (typeof header === "string") {
        headers[name] = header;
        legacy[name] = header;
        continue;
      }
      if (isConfiguredHeaderBinding(header)) {
        headers[name] = header;
        continue;
      }
      legacy[name] = header;
      headers[name] = new ConfiguredHeaderBinding({
        kind: "binding",
        slot: headerBindingSlot(name),
        prefix: header.prefix,
      });
    }
    yield* Schema.decodeUnknownEffect(ConfiguredHeaderValueMap)(headers).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            message: "Failed to decode normalized OpenAPI source headers",
            cause,
          }),
      ),
    );
    return { headers, legacy };
  });

const normalizeStoredOAuth2 = (
  value: unknown,
): Effect.Effect<
  {
    readonly oauth2?: OAuth2SourceConfig;
    readonly legacy?: OAuth2Auth;
  },
  StorageFailure
> =>
  Effect.gen(function* () {
    if (value == null) return {};
    return yield* Schema.decodeUnknownEffect(
      typeof value === "string" ? JsonOAuth2SourceConfig : OAuth2SourceConfig,
    )(value).pipe(
      Effect.matchEffect({
        onSuccess: (oauth2) => Effect.succeed({ oauth2 }),
        onFailure: () =>
          Schema.decodeUnknownEffect(typeof value === "string" ? JsonOAuth2Auth : OAuth2Auth)(
            value,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  message: "Failed to decode OpenAPI source OAuth2 configuration",
                  cause,
                }),
            ),
            Effect.map((legacy) => ({
              legacy,
              oauth2: new OAuth2SourceConfig({
                kind: "oauth2",
                securitySchemeName: legacy.securitySchemeName,
                flow: legacy.flow,
                tokenUrl: legacy.tokenUrl,
                authorizationUrl: legacy.authorizationUrl,
                clientIdSlot: oauth2ClientIdSlot(legacy.securitySchemeName),
                clientSecretSlot: legacy.clientSecretSecretId
                  ? oauth2ClientSecretSlot(legacy.securitySchemeName)
                  : null,
                connectionSlot: oauth2ConnectionSlot(legacy.securitySchemeName),
                scopes: [...legacy.scopes],
              }),
            })),
          ),
      }),
    );
  });

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
// multiple scopes — e.g. an org-level openapi source with a per-user
// override), that's a scope-isolation bug: updates and deletes can
// land on the wrong scope's row. Callers thread the resolved scope in
// (typically `path.scopeId` for HTTP, `toolRow.scope_id` /
// `input.scope` for invokeTool/lifecycle) so every keyed mutation
// targets exactly one row.
export interface OpenapiStore {
  readonly upsertSource: (
    input: StoredSource,
    operations: readonly StoredOperation[],
  ) => Effect.Effect<void, StorageFailure>;

  readonly updateSourceMeta: (
    namespace: string,
    scope: string,
    patch: {
      readonly name?: string;
      readonly baseUrl?: string;
      readonly headers?: Record<string, ConfiguredHeaderValue>;
      readonly queryParams?: Record<string, HeaderValue>;
      readonly oauth2?: OAuth2SourceConfig;
    },
  ) => Effect.Effect<void, StorageFailure>;

  readonly getSource: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<StoredSource | null, StorageFailure>;

  readonly listSources: () => Effect.Effect<readonly StoredSource[], StorageFailure>;

  readonly getOperationByToolId: (
    toolId: string,
    scope: string,
  ) => Effect.Effect<StoredOperation | null, StorageFailure>;

  readonly listOperationsBySource: (
    sourceId: string,
    scope: string,
  ) => Effect.Effect<readonly StoredOperation[], StorageFailure>;

  readonly removeSource: (namespace: string, scope: string) => Effect.Effect<void, StorageFailure>;

  readonly listSourceBindings: (
    sourceId: string,
    sourceScope: string,
  ) => Effect.Effect<readonly OpenApiSourceBindingRef[], StorageFailure>;

  readonly resolveSourceBinding: (
    sourceId: string,
    sourceScope: string,
    slot: string,
  ) => Effect.Effect<OpenApiSourceBindingRef | null, StorageFailure>;

  readonly setSourceBinding: (
    input: OpenApiSourceBindingInput,
  ) => Effect.Effect<OpenApiSourceBindingRef, StorageFailure>;

  readonly removeSourceBinding: (
    sourceId: string,
    sourceScope: string,
    slot: string,
    scope: string,
  ) => Effect.Effect<void, StorageFailure>;

  // ---------------------------------------------------------------------
  // Usage lookups — back `usagesForSecret` / `usagesForConnection`.
  // Each is one indexed SELECT against the new normalized columns.
  // ---------------------------------------------------------------------

  /** Source-binding rows that point at the given secret id. */
  readonly findBindingsBySecret: (
    secretId: string,
  ) => Effect.Effect<readonly OpenApiSourceBindingRef[], StorageFailure>;

  /** Source-binding rows that point at the given connection id. */
  readonly findBindingsByConnection: (
    connectionId: string,
  ) => Effect.Effect<readonly OpenApiSourceBindingRef[], StorageFailure>;

  /** Child rows from query_params / specFetch tables that reference the
   *  given secret id, tagged with the table they came from so the
   *  caller can produce a readable `slot` like
   *  `query_param:foo` or `spec_fetch_header:Authorization`. */
  readonly findChildRowsBySecret: (secretId: string) => Effect.Effect<
    readonly {
      readonly kind: "query_param" | "spec_fetch_header" | "spec_fetch_query_param";
      readonly source_id: string;
      readonly scope_id: string;
      readonly name: string;
    }[],
    StorageFailure
  >;

  /** Resolve display names for one or more `(scope_id, source_id)` pairs
   *  in a single round trip, keyed by `${scope_id}:${source_id}`. */
  readonly lookupSourceNames: (
    keys: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, string>, StorageFailure>;
}

// ---------------------------------------------------------------------------
// Default store implementation
// ---------------------------------------------------------------------------

export const makeDefaultOpenapiStore = ({
  adapter,
  scopes,
}: StorageDeps<OpenapiSchema>): OpenapiStore => {
  const scopeIds = scopes.map((scope) => String(scope.id));
  const scopePrecedence = new Map<string, number>();
  scopeIds.forEach((scope, index) => scopePrecedence.set(scope, index));
  const scopeRank = (scopeId: string): number => scopePrecedence.get(scopeId) ?? Infinity;

  const encodeSyntheticRowIdPart = (value: string): string => encodeURIComponent(value);

  const sourceBindingRowId = (
    sourceId: string,
    sourceScopeId: string,
    slot: string,
    scopeId: string,
  ) =>
    [
      "openapi-source-binding",
      encodeSyntheticRowIdPart(sourceScopeId),
      encodeSyntheticRowIdPart(sourceId),
      encodeSyntheticRowIdPart(slot),
      encodeSyntheticRowIdPart(scopeId),
    ].join("::");

  const rowToSourceBindingValue = (
    row: typeof OpenApiSourceBindingRowSchema.Type,
  ): OpenApiSourceBindingValue => {
    if (row.kind === "secret" && row.secret_id !== undefined) {
      return { kind: "secret", secretId: SecretId.make(row.secret_id) };
    }
    if (row.kind === "connection" && row.connection_id !== undefined) {
      return {
        kind: "connection",
        connectionId: ConnectionId.make(row.connection_id),
      };
    }
    // text fallback covers both well-formed text rows and any
    // partial/null row that survived a malformed write — `text_value`
    // defaults to "" so the type stays satisfied without a throw.
    return { kind: "text", text: (row.text_value as string | null) ?? "" };
  };

  const rowToSourceBinding = (
    row: unknown,
  ): Effect.Effect<OpenApiSourceBindingRef, StorageFailure> =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(OpenApiSourceBindingRowSchema)(row).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              message: "Failed to decode OpenAPI source binding row",
              cause,
            }),
        ),
      );
      return new OpenApiSourceBindingRef({
        sourceId: decoded.source_id,
        sourceScopeId: ScopeId.make(decoded.source_scope_id),
        scopeId: ScopeId.make(decoded.target_scope_id),
        slot: decoded.slot,
        value: rowToSourceBindingValue(decoded),
        createdAt: decoded.created_at,
        updatedAt: decoded.updated_at,
      });
    });

  const sourceBindingValueColumns = (
    value: OpenApiSourceBindingValue,
  ): { kind: string; secret_id?: string; connection_id?: string; text_value?: string } => {
    if (value.kind === "secret") {
      return { kind: "secret", secret_id: value.secretId };
    }
    if (value.kind === "connection") {
      return { kind: "connection", connection_id: value.connectionId };
    }
    return { kind: "text", text_value: value.text };
  };

  const validateBindingScopes = (params: {
    readonly sourceScope: string;
    readonly targetScope: string;
  }) =>
    Effect.gen(function* () {
      if (!scopeIds.includes(params.sourceScope)) {
        return yield* new StorageError({
          message:
            `OpenAPI source binding references source scope "${params.sourceScope}" ` +
            `which is not in the executor's scope stack [${scopeIds.join(", ")}].`,
          cause: undefined,
        });
      }
      if (!scopeIds.includes(params.targetScope)) {
        return yield* new StorageError({
          message:
            `OpenAPI source binding targets scope "${params.targetScope}" which is not ` +
            `in the executor's scope stack [${scopeIds.join(", ")}].`,
          cause: undefined,
        });
      }
    });

  const validateBindingTarget = (params: {
    readonly sourceId: string;
    readonly sourceScope: string;
    readonly targetScope: string;
  }) =>
    Effect.gen(function* () {
      yield* validateBindingScopes({
        sourceScope: params.sourceScope,
        targetScope: params.targetScope,
      });
      const source = yield* adapter.findOne({
        model: "openapi_source",
        where: [
          { field: "id", value: params.sourceId },
          { field: "scope_id", value: params.sourceScope },
        ],
      });
      if (!source) {
        return yield* new StorageError({
          message: `OpenAPI source "${params.sourceId}" does not exist at scope "${params.sourceScope}"`,
          cause: undefined,
        });
      }
      if (scopeRank(params.targetScope) > scopeRank(params.sourceScope)) {
        return yield* new StorageError({
          message:
            `OpenAPI source bindings for "${params.sourceId}" cannot be written at ` +
            `outer scope "${params.targetScope}" because the base source lives at ` +
            `"${params.sourceScope}"`,
          cause: undefined,
        });
      }
      return source;
    });

  const loadChildValueMap = (
    model:
      | "openapi_source_query_param"
      | "openapi_source_spec_fetch_header"
      | "openapi_source_spec_fetch_query_param",
    sourceId: string,
    scope: string,
  ) =>
    adapter
      .findMany({
        model,
        where: [
          { field: "source_id", value: sourceId },
          { field: "scope_id", value: scope },
        ],
      })
      .pipe(Effect.flatMap(childRowsToValueMap));

  const rowToSource = (row: Record<string, unknown>): Effect.Effect<StoredSource, StorageFailure> =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(OpenApiSourceRowSchema)(row).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              message: "Failed to decode OpenAPI source row",
              cause,
            }),
        ),
      );
      const sourceId = decoded.id;
      const scope = decoded.scope_id;
      const normalizedHeaders = yield* normalizeStoredHeaders(decoded.headers);
      const normalizedOAuth2 = yield* normalizeStoredOAuth2(decoded.oauth2);

      const queryParams = yield* loadChildValueMap("openapi_source_query_param", sourceId, scope);
      const specFetchHeaders = yield* loadChildValueMap(
        "openapi_source_spec_fetch_header",
        sourceId,
        scope,
      );
      const specFetchQueryParams = yield* loadChildValueMap(
        "openapi_source_spec_fetch_query_param",
        sourceId,
        scope,
      );
      const specFetchCredentials: OpenApiSpecFetchCredentials | undefined =
        Object.keys(specFetchHeaders).length === 0 && Object.keys(specFetchQueryParams).length === 0
          ? undefined
          : {
              ...(Object.keys(specFetchHeaders).length > 0 ? { headers: specFetchHeaders } : {}),
              ...(Object.keys(specFetchQueryParams).length > 0
                ? { queryParams: specFetchQueryParams }
                : {}),
            };

      return {
        namespace: sourceId,
        scope,
        name: decoded.name,
        config: {
          spec: decoded.spec,
          sourceUrl: decoded.source_url ?? undefined,
          baseUrl: decoded.base_url ?? undefined,
          headers: normalizedHeaders.headers,
          queryParams,
          specFetchCredentials,
          oauth2: normalizedOAuth2.oauth2,
        },
        legacy:
          Object.keys(normalizedHeaders.legacy).length > 0 || normalizedOAuth2.legacy
            ? {
                ...(Object.keys(normalizedHeaders.legacy).length > 0
                  ? { headers: normalizedHeaders.legacy }
                  : {}),
                ...(normalizedOAuth2.legacy ? { oauth2: normalizedOAuth2.legacy } : {}),
              }
            : undefined,
      };
    });

  const rowToOperation = (
    row: Record<string, unknown>,
  ): Effect.Effect<StoredOperation, StorageFailure> =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(OpenApiOperationRowSchema)(row).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              message: "Failed to decode OpenAPI operation row",
              cause,
            }),
        ),
      );
      const binding = yield* Schema.decodeUnknownEffect(
        typeof decoded.binding === "string" ? JsonOperationBinding : OperationBinding,
      )(decoded.binding).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              message: "Failed to decode OpenAPI operation binding",
              cause,
            }),
        ),
      );
      return {
        toolId: decoded.id,
        sourceId: decoded.source_id,
        binding,
      };
    });

  // Replace the rows of one child table for a source: delete then bulk
  // insert. Single helper so upsertSource and updateSourceMeta both
  // funnel through the same write path.
  const replaceChildRows = (
    model:
      | "openapi_source_query_param"
      | "openapi_source_spec_fetch_header"
      | "openapi_source_spec_fetch_query_param",
    sourceId: string,
    scope: string,
    values: Record<string, HeaderValue> | undefined,
  ) =>
    Effect.gen(function* () {
      yield* adapter.deleteMany({
        model,
        where: [
          { field: "source_id", value: sourceId },
          { field: "scope_id", value: scope },
        ],
      });
      const rows = valueMapToChildRows(sourceId, scope, values);
      if (rows.length === 0) return;
      yield* adapter.createMany({
        model,
        data: rows,
        forceAllowId: true,
      });
    });

  const deleteSource = (
    namespace: string,
    scope: string,
    options?: { readonly includeBindings?: boolean },
  ) =>
    Effect.gen(function* () {
      yield* adapter.deleteMany({
        model: "openapi_operation",
        where: [
          { field: "source_id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
      // Drop every child table's rows for this source/scope.
      for (const model of [
        "openapi_source_query_param",
        "openapi_source_spec_fetch_header",
        "openapi_source_spec_fetch_query_param",
      ] as const) {
        yield* adapter.deleteMany({
          model,
          where: [
            { field: "source_id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
      }
      yield* adapter.delete({
        model: "openapi_source",
        where: [
          { field: "id", value: namespace },
          { field: "scope_id", value: scope },
        ],
      });
      if (options?.includeBindings) {
        yield* adapter.deleteMany({
          model: "openapi_source_binding",
          where: [
            { field: "source_id", value: namespace },
            { field: "source_scope_id", value: scope },
          ],
        });
      }
    });

  return {
    upsertSource: (input, operations) =>
      Effect.gen(function* () {
        yield* deleteSource(input.namespace, input.scope);
        yield* adapter.create({
          model: "openapi_source",
          data: {
            id: input.namespace,
            scope_id: input.scope,
            name: input.name,
            spec: input.config.spec,
            source_url: input.config.sourceUrl ?? undefined,
            base_url: input.config.baseUrl ?? undefined,
            headers: Object.fromEntries(
              Object.entries(input.config.headers ?? {}).map(([name, value]) => [
                name,
                typeof value === "string"
                  ? value
                  : value.kind === "binding"
                    ? {
                        kind: value.kind,
                        slot: value.slot,
                        ...(value.prefix ? { prefix: value.prefix } : {}),
                      }
                    : value,
              ]),
            ) as Record<string, unknown>,
            oauth2: input.config.oauth2
              ? toJsonRecord(encodeOAuth2SourceConfig(input.config.oauth2))
              : undefined,
          },
          forceAllowId: true,
        });
        yield* replaceChildRows(
          "openapi_source_query_param",
          input.namespace,
          input.scope,
          input.config.queryParams,
        );
        yield* replaceChildRows(
          "openapi_source_spec_fetch_header",
          input.namespace,
          input.scope,
          input.config.specFetchCredentials?.headers,
        );
        yield* replaceChildRows(
          "openapi_source_spec_fetch_query_param",
          input.namespace,
          input.scope,
          input.config.specFetchCredentials?.queryParams,
        );
        if (operations.length > 0) {
          yield* adapter.createMany({
            model: "openapi_operation",
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
        const existingRow = yield* adapter.findOne({
          model: "openapi_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        if (!existingRow) return;
        const existing = yield* rowToSource(existingRow);

        const nextName = patch.name?.trim() || existing.name;
        const nextBaseUrl = patch.baseUrl !== undefined ? patch.baseUrl : existing.config.baseUrl;
        const nextHeaders =
          patch.headers !== undefined ? patch.headers : (existing.config.headers ?? {});
        const nextOAuth2 = patch.oauth2 !== undefined ? patch.oauth2 : existing.config.oauth2;

        yield* adapter.update({
          model: "openapi_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
          update: {
            name: nextName,
            base_url: nextBaseUrl ?? undefined,
            headers: Object.fromEntries(
              Object.entries(nextHeaders).map(([name, value]) => [
                name,
                typeof value === "string"
                  ? value
                  : {
                      kind: value.kind,
                      slot: value.slot,
                      ...(value.prefix ? { prefix: value.prefix } : {}),
                    },
              ]),
            ) as Record<string, unknown>,
            oauth2: nextOAuth2 ? toJsonRecord(encodeOAuth2SourceConfig(nextOAuth2)) : undefined,
          },
        });
        if (patch.queryParams !== undefined) {
          yield* replaceChildRows(
            "openapi_source_query_param",
            namespace,
            scope,
            patch.queryParams,
          );
        }
      }),

    getSource: (namespace, scope) =>
      Effect.gen(function* () {
        const row = yield* adapter.findOne({
          model: "openapi_source",
          where: [
            { field: "id", value: namespace },
            { field: "scope_id", value: scope },
          ],
        });
        if (!row) return null;
        return yield* rowToSource(row);
      }),

    listSources: () =>
      Effect.gen(function* () {
        const rows = yield* adapter.findMany({ model: "openapi_source" });
        return yield* Effect.forEach(rows, rowToSource, {
          concurrency: "unbounded",
        });
      }),

    getOperationByToolId: (toolId, scope) =>
      adapter
        .findOne({
          model: "openapi_operation",
          where: [
            { field: "id", value: toolId },
            { field: "scope_id", value: scope },
          ],
        })
        .pipe(Effect.flatMap((row) => (row ? rowToOperation(row) : Effect.succeed(null)))),

    listOperationsBySource: (sourceId, scope) =>
      adapter
        .findMany({
          model: "openapi_operation",
          where: [
            { field: "source_id", value: sourceId },
            { field: "scope_id", value: scope },
          ],
        })
        .pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, rowToOperation, { concurrency: "unbounded" }),
          ),
        ),

    removeSource: (namespace, scope) => deleteSource(namespace, scope, { includeBindings: true }),

    listSourceBindings: (sourceId, sourceScope) =>
      Effect.gen(function* () {
        yield* validateBindingScopes({
          sourceScope,
          targetScope: sourceScope,
        });
        const sourceScopeRank = scopeRank(sourceScope);
        const rows = yield* adapter.findMany({
          model: "openapi_source_binding",
          where: [
            { field: "source_id", value: sourceId },
            { field: "source_scope_id", value: sourceScope },
          ],
        });
        const decodedRows = yield* Schema.decodeUnknownEffect(
          Schema.Array(OpenApiSourceBindingRowSchema),
        )(rows).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                message: "Failed to decode OpenAPI source binding rows",
                cause,
              }),
          ),
        );
        const visibleRows = decodedRows
          .filter((row) => scopeRank(row.target_scope_id) <= sourceScopeRank)
          .sort((a, b) => scopeRank(a.target_scope_id) - scopeRank(b.target_scope_id));
        return yield* Effect.forEach(visibleRows, (row) => rowToSourceBinding(row), {
          concurrency: "unbounded",
        });
      }),

    resolveSourceBinding: (sourceId, sourceScope, slot) =>
      Effect.gen(function* () {
        yield* validateBindingScopes({
          sourceScope,
          targetScope: sourceScope,
        });
        const rows = yield* adapter.findMany({
          model: "openapi_source_binding",
          where: [
            { field: "source_id", value: sourceId },
            { field: "source_scope_id", value: sourceScope },
            { field: "slot", value: slot },
          ],
        });
        const sourceScopeRank = scopeRank(sourceScope);
        const decodedRows = yield* Schema.decodeUnknownEffect(
          Schema.Array(OpenApiSourceBindingRowSchema),
        )(rows).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                message: "Failed to decode OpenAPI source binding rows",
                cause,
              }),
          ),
        );
        const row = decodedRows
          .filter((candidate) => scopeRank(candidate.target_scope_id) <= sourceScopeRank)
          .sort((a, b) => scopeRank(a.target_scope_id) - scopeRank(b.target_scope_id))[0];
        return row ? yield* rowToSourceBinding(row) : null;
      }),

    setSourceBinding: (input) =>
      Effect.gen(function* () {
        yield* validateBindingTarget({
          sourceId: input.sourceId,
          sourceScope: input.sourceScope,
          targetScope: input.scope,
        });
        const id = sourceBindingRowId(input.sourceId, input.sourceScope, input.slot, input.scope);
        const now = new Date();
        const valueColumns = sourceBindingValueColumns(input.value);
        yield* adapter.delete({
          model: "openapi_source_binding",
          where: [{ field: "id", value: id }],
        });
        yield* adapter.create({
          model: "openapi_source_binding",
          data: {
            id,
            source_id: input.sourceId,
            source_scope_id: input.sourceScope,
            target_scope_id: input.scope,
            slot: input.slot,
            ...valueColumns,
            created_at: now,
            updated_at: now,
          },
          forceAllowId: true,
        });
        return new OpenApiSourceBindingRef({
          sourceId: input.sourceId,
          sourceScopeId: input.sourceScope,
          scopeId: input.scope,
          slot: input.slot,
          value: input.value,
          createdAt: now,
          updatedAt: now,
        });
      }),

    removeSourceBinding: (sourceId, sourceScope, slot, scope) =>
      Effect.gen(function* () {
        yield* validateBindingTarget({
          sourceId,
          sourceScope,
          targetScope: scope,
        });
        yield* adapter.delete({
          model: "openapi_source_binding",
          where: [
            {
              field: "id",
              value: sourceBindingRowId(sourceId, sourceScope, slot, scope),
            },
          ],
        });
      }),

    findBindingsBySecret: (secretId) =>
      adapter
        .findMany({
          model: "openapi_source_binding",
          where: [{ field: "secret_id", value: secretId }],
        })
        .pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, rowToSourceBinding, {
              concurrency: "unbounded",
            }),
          ),
        ),

    findBindingsByConnection: (connectionId) =>
      adapter
        .findMany({
          model: "openapi_source_binding",
          where: [{ field: "connection_id", value: connectionId }],
        })
        .pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, rowToSourceBinding, {
              concurrency: "unbounded",
            }),
          ),
        ),

    findChildRowsBySecret: (secretId) =>
      Effect.gen(function* () {
        const tables = [
          { model: "openapi_source_query_param" as const, kind: "query_param" as const },
          {
            model: "openapi_source_spec_fetch_header" as const,
            kind: "spec_fetch_header" as const,
          },
          {
            model: "openapi_source_spec_fetch_query_param" as const,
            kind: "spec_fetch_query_param" as const,
          },
        ];
        const perTable = yield* Effect.forEach(
          tables,
          (t) =>
            adapter
              .findMany({
                model: t.model,
                where: [{ field: "secret_id", value: secretId }],
              })
              .pipe(
                Effect.flatMap((rows) =>
                  Schema.decodeUnknownEffect(Schema.Array(SourceChildUsageRowSchema))(rows).pipe(
                    Effect.mapError(
                      (cause) =>
                        new StorageError({
                          message: "Failed to decode OpenAPI source child usage rows",
                          cause,
                        }),
                    ),
                    Effect.map((decodedRows) =>
                      decodedRows.map((r) => ({
                        kind: t.kind,
                        source_id: r.source_id,
                        scope_id: r.scope_id,
                        name: r.name,
                      })),
                    ),
                  ),
                ),
              ),
          { concurrency: "unbounded" },
        );
        return perTable.flat();
      }),

    lookupSourceNames: (keys) =>
      Effect.gen(function* () {
        if (keys.length === 0) return new Map<string, string>();
        const rows = yield* adapter.findMany({ model: "openapi_source" });
        const decodedRows = yield* Schema.decodeUnknownEffect(Schema.Array(SourceNameRowSchema))(
          rows,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new StorageError({
                message: "Failed to decode OpenAPI source name rows",
                cause,
              }),
          ),
        );
        const requested = new Set(keys);
        const out = new Map<string, string>();
        for (const r of decodedRows) {
          const key = `${r.scope_id}:${r.id}`;
          if (requested.has(key)) out.set(key, r.name);
        }
        return out;
      }),
  };
};
