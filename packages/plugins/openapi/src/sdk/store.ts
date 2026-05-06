import { Effect, Option, Schema } from "effect";

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
const decodeBinding = Schema.decodeUnknownSync(OperationBinding);
const decodeBindingJson = Schema.decodeUnknownSync(Schema.fromJsonString(OperationBinding));

const decodeOAuth2 = Schema.decodeUnknownSync(OAuth2Auth);
const decodeOAuth2Option = Schema.decodeUnknownOption(OAuth2Auth);
const decodeOAuth2JsonOption = Schema.decodeUnknownOption(Schema.fromJsonString(OAuth2Auth));
const decodeOAuth2SourceConfigOption = Schema.decodeUnknownOption(OAuth2SourceConfig);
const decodeOAuth2SourceConfigJsonOption = Schema.decodeUnknownOption(
  Schema.fromJsonString(OAuth2SourceConfig),
);
const encodeOAuth2SourceConfig = Schema.encodeSync(OAuth2SourceConfig);

const decodeHeaderValueOption = Schema.decodeUnknownOption(HeaderValue);
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeUnknownRecord = Schema.decodeUnknownSync(UnknownRecord);
const decodeUnknownRecordJson = Schema.decodeUnknownSync(Schema.fromJsonString(UnknownRecord));
const decodeConfiguredHeaderBindingOption = Schema.decodeUnknownOption(ConfiguredHeaderBinding);

const NullableString = Schema.NullOr(Schema.String);
const OptionalNullableString = Schema.optional(NullableString);

const ChildStorageRow = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["text", "secret"]),
  text_value: OptionalNullableString,
  secret_id: OptionalNullableString,
  secret_prefix: OptionalNullableString,
});
const decodeChildStorageRowOption = Schema.decodeUnknownOption(ChildStorageRow);

const SourceBindingStorageRow = Schema.Struct({
  source_id: Schema.String,
  source_scope_id: Schema.String,
  target_scope_id: Schema.String,
  slot: Schema.String,
  kind: Schema.Literals(["secret", "connection", "text"]),
  secret_id: OptionalNullableString,
  connection_id: OptionalNullableString,
  text_value: OptionalNullableString,
  created_at: Schema.Unknown,
  updated_at: Schema.Unknown,
});
const decodeSourceBindingStorageRow = Schema.decodeUnknownSync(SourceBindingStorageRow);

const SourceStorageRow = Schema.Struct({
  id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
  spec: Schema.String,
  source_url: OptionalNullableString,
  base_url: OptionalNullableString,
  headers: Schema.optional(Schema.Unknown),
  oauth2: Schema.optional(Schema.Unknown),
});
const decodeSourceStorageRow = Schema.decodeUnknownSync(SourceStorageRow);

const OperationStorageRow = Schema.Struct({
  id: Schema.String,
  source_id: Schema.String,
  binding: Schema.Unknown,
});
const decodeOperationStorageRow = Schema.decodeUnknownSync(OperationStorageRow);

const ChildUsageStorageRow = Schema.Struct({
  source_id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
});
const decodeChildUsageStorageRow = Schema.decodeUnknownSync(ChildUsageStorageRow);

const SourceNameStorageRow = Schema.Struct({
  id: Schema.String,
  scope_id: Schema.String,
  name: Schema.String,
});
const decodeSourceNameStorageRow = Schema.decodeUnknownSync(SourceNameStorageRow);

const decodeStorageString = Schema.decodeUnknownSync(Schema.String);

const decodeStorageDate = (value: unknown): Date =>
  value instanceof Date ? value : new Date(decodeStorageString(value));

interface ChildRow {
  readonly id: string;
  readonly scope_id: string;
  readonly source_id: string;
  readonly name: string;
  readonly kind: "text" | "secret";
  readonly text_value?: string;
  readonly secret_id?: string;
  readonly secret_prefix?: string;
  // Index signature to satisfy adapter's `RowInput` shape (the typed
  // adapter exposes its row shape with one).
  readonly [k: string]: unknown;
}

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
): Record<string, HeaderValue> => {
  const out: Record<string, HeaderValue> = {};
  for (const row of rows) {
    const decoded = decodeChildStorageRowOption(row);
    if (Option.isSome(decoded)) {
      const child = decoded.value;
      if (child.kind === "secret" && child.secret_id != null) {
        out[child.name] =
          child.secret_prefix != null
            ? { secretId: child.secret_id, prefix: child.secret_prefix }
            : { secretId: child.secret_id };
      } else if (child.kind === "text" && child.text_value != null) {
        out[child.name] = child.text_value;
      }
    }
  }
  return out;
};

// oxlint-disable-next-line executor/no-explicit-unknown-record -- boundary: storage adapter accepts JSON object columns
const toJsonRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

const toConfiguredHeaderBinding = (value: {
  readonly slot?: unknown;
  readonly prefix?: unknown;
}): ConfiguredHeaderBinding =>
  new ConfiguredHeaderBinding({
    kind: "binding",
    slot: String(value.slot ?? ""),
    ...(typeof value.prefix === "string" ? { prefix: value.prefix } : {}),
  });

const decodeHeaders = (value: unknown): Record<string, unknown> => {
  if (value == null) return {};
  if (typeof value === "string") return decodeUnknownRecordJson(value);
  return decodeUnknownRecord(value);
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
): {
  readonly headers: Record<string, ConfiguredHeaderValue>;
  readonly legacy: Record<string, HeaderValue>;
} => {
  const raw = decodeHeaders(value);
  const headers: Record<string, ConfiguredHeaderValue> = {};
  const legacy: Record<string, HeaderValue> = {};
  for (const [name, header] of Object.entries(raw)) {
    if (typeof header === "string") {
      headers[name] = header;
      legacy[name] = header;
      continue;
    }
    const binding = decodeConfiguredHeaderBindingOption(header);
    if (Option.isSome(binding)) {
      headers[name] = toConfiguredHeaderBinding(binding.value);
      continue;
    }
    const legacyHeader = decodeHeaderValueOption(header);
    if (Option.isNone(legacyHeader)) continue;
    legacy[name] = legacyHeader.value;
    headers[name] = new ConfiguredHeaderBinding({
      kind: "binding",
      slot: headerBindingSlot(name),
      prefix: typeof legacyHeader.value === "string" ? undefined : legacyHeader.value.prefix,
    });
  }
  return { headers, legacy };
};

const normalizeStoredOAuth2 = (
  value: unknown,
): {
  readonly oauth2?: OAuth2SourceConfig;
  readonly legacy?: OAuth2Auth;
} => {
  if (value == null) return {};
  const sourceConfig =
    typeof value === "string"
      ? decodeOAuth2SourceConfigJsonOption(value)
      : decodeOAuth2SourceConfigOption(value);
  if (Option.isSome(sourceConfig)) {
    return { oauth2: sourceConfig.value };
  }
  const legacyOption =
    typeof value === "string" ? decodeOAuth2JsonOption(value) : decodeOAuth2Option(value);
  const legacy = Option.isSome(legacyOption) ? legacyOption.value : decodeOAuth2(value);
  return {
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
  };
};

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

  const rowToSourceBindingValue = (row: Record<string, unknown>): OpenApiSourceBindingValue => {
    const decoded = decodeSourceBindingStorageRow(row);
    if (decoded.kind === "secret" && decoded.secret_id != null) {
      return { kind: "secret", secretId: SecretId.make(decoded.secret_id) };
    }
    if (decoded.kind === "connection" && decoded.connection_id != null) {
      return {
        kind: "connection",
        connectionId: ConnectionId.make(decoded.connection_id),
      };
    }
    // text fallback covers both well-formed text rows and any
    // partial/null row that survived a malformed write — `text_value`
    // defaults to "" so the type stays satisfied without a throw.
    return { kind: "text", text: decoded.text_value ?? "" };
  };

  const rowToSourceBinding = (row: Record<string, unknown>): OpenApiSourceBindingRef => {
    const decoded = decodeSourceBindingStorageRow(row);
    return new OpenApiSourceBindingRef({
      sourceId: decoded.source_id,
      sourceScopeId: ScopeId.make(decoded.source_scope_id),
      scopeId: ScopeId.make(decoded.target_scope_id),
      slot: decoded.slot,
      value: rowToSourceBindingValue(row),
      createdAt: decodeStorageDate(decoded.created_at),
      updatedAt: decodeStorageDate(decoded.updated_at),
    });
  };

  const sourceBindingTargetScope = (row: Record<string, unknown>): string =>
    decodeSourceBindingStorageRow(row).target_scope_id;

  const sourceBindingValueColumns = (
    value: OpenApiSourceBindingValue,
  ): {
    kind: string;
    secret_id?: string;
    connection_id?: string;
    text_value?: string;
  } => {
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
      .pipe(Effect.map(childRowsToValueMap));

  const rowToSource = (row: Record<string, unknown>): Effect.Effect<StoredSource, StorageFailure> =>
    Effect.gen(function* () {
      const sourceRow = decodeSourceStorageRow(row);
      const sourceId = sourceRow.id;
      const scope = sourceRow.scope_id;
      const normalizedHeaders = normalizeStoredHeaders(sourceRow.headers);
      const normalizedOAuth2 = normalizeStoredOAuth2(sourceRow.oauth2);

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
        name: sourceRow.name,
        config: {
          spec: sourceRow.spec,
          sourceUrl: sourceRow.source_url ?? undefined,
          baseUrl: sourceRow.base_url ?? undefined,
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

  const rowToOperation = (row: Record<string, unknown>): StoredOperation => {
    const operationRow = decodeOperationStorageRow(row);
    return {
      toolId: operationRow.id,
      sourceId: operationRow.source_id,
      binding: decodeBinding(
        typeof operationRow.binding === "string"
          ? decodeBindingJson(operationRow.binding)
          : operationRow.binding,
      ),
    };
  };

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
        .pipe(Effect.map((row) => (row ? rowToOperation(row) : null))),

    listOperationsBySource: (sourceId, scope) =>
      adapter
        .findMany({
          model: "openapi_operation",
          where: [
            { field: "source_id", value: sourceId },
            { field: "scope_id", value: scope },
          ],
        })
        .pipe(Effect.map((rows) => rows.map(rowToOperation))),

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
        return rows
          .filter((row) => scopeRank(sourceBindingTargetScope(row)) <= sourceScopeRank)
          .sort(
            (a, b) =>
              scopeRank(sourceBindingTargetScope(a)) - scopeRank(sourceBindingTargetScope(b)),
          )
          .map(rowToSourceBinding);
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
        const row = rows
          .filter((candidate) => scopeRank(sourceBindingTargetScope(candidate)) <= sourceScopeRank)
          .sort(
            (a, b) =>
              scopeRank(sourceBindingTargetScope(a)) - scopeRank(sourceBindingTargetScope(b)),
          )[0];
        return row ? rowToSourceBinding(row) : null;
      }),

    setSourceBinding: (input) =>
      Effect.gen(function* () {
        const sourceScope = String(input.sourceScope);
        const targetScope = String(input.scope);
        yield* validateBindingTarget({
          sourceId: input.sourceId,
          sourceScope,
          targetScope,
        });
        const id = sourceBindingRowId(input.sourceId, sourceScope, input.slot, targetScope);
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
            source_scope_id: sourceScope,
            target_scope_id: targetScope,
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
        .pipe(Effect.map((rows) => rows.map(rowToSourceBinding))),

    findBindingsByConnection: (connectionId) =>
      adapter
        .findMany({
          model: "openapi_source_binding",
          where: [{ field: "connection_id", value: connectionId }],
        })
        .pipe(Effect.map((rows) => rows.map(rowToSourceBinding))),

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
                Effect.map((rows) =>
                  rows.map((r) => {
                    const row = decodeChildUsageStorageRow(r);
                    return {
                      kind: t.kind,
                      source_id: row.source_id,
                      scope_id: row.scope_id,
                      name: row.name,
                    };
                  }),
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
        const requested = new Set(keys);
        const out = new Map<string, string>();
        for (const r of rows) {
          const row = decodeSourceNameStorageRow(r);
          const key = `${row.scope_id}:${row.id}`;
          if (requested.has(key)) out.set(key, row.name);
        }
        return out;
      }),
  };
};
