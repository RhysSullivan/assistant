import { Effect, Option } from "effect";
import { FetchHttpClient, HttpClient } from "@effect/platform";
import type { Layer } from "effect";

import {
  definePlugin,
  SourceDetectionResult,
  type StorageFailure,
  type ToolAnnotations,
  type ToolRow,
} from "@executor/sdk";

import {
  headersToConfigValues,
  type ConfigFileSink,
  type GraphqlSourceConfig as GraphqlConfigEntry,
} from "@executor/config";

import {
  introspect,
  parseIntrospectionJson,
  type IntrospectionResult,
  type IntrospectionType,
  type IntrospectionField,
  type IntrospectionTypeRef,
} from "./introspect";
import { extract } from "./extract";
import { GraphqlExtractionError, GraphqlIntrospectionError } from "./errors";
import { invokeWithLayer, resolveHeaders } from "./invoke";
import {
  graphqlSchema,
  makeDefaultGraphqlStore,
  type GraphqlStore,
  type StoredGraphqlSource,
  type StoredOperation,
} from "./store";
import {
  AnnotationPolicy,
  ExtractedField,
  OperationBinding,
  type HeaderValue as HeaderValueValue,
  type GraphqlOperationKind,
} from "./types";

// ---------------------------------------------------------------------------
// Plugin config
// ---------------------------------------------------------------------------

export type HeaderValue = HeaderValueValue;

export interface GraphqlSourceConfig {
  /** The GraphQL endpoint URL */
  readonly endpoint: string;
  /**
   * Executor scope id that owns this source row. Must be one of the
   * executor's configured scopes. Typical shape: an admin adds the
   * source at the outermost (organization) scope so it's visible to
   * every inner (per-user) scope via fall-through reads. When omitted,
   * the plugin defaults to the innermost scope (`ctx.scopes[0].id`).
   */
  readonly scope?: string;
  /** Display name for the source. Falls back to namespace if not provided. */
  readonly name?: string;
  /** Optional: introspection JSON text (if endpoint doesn't support introspection) */
  readonly introspectionJson?: string;
  /** Namespace for the tools (derived from endpoint if not provided) */
  readonly namespace?: string;
  /** Headers applied to every request. Values can reference secrets. */
  readonly headers?: Record<string, HeaderValue>;
  /** Per-source annotation policy override. Omitted = plugin defaults. */
  readonly annotationPolicy?: AnnotationPolicy;
}

// ---------------------------------------------------------------------------
// Plugin extension
// ---------------------------------------------------------------------------

export interface GraphqlUpdateSourceInput {
  readonly name?: string;
  readonly endpoint?: string;
  readonly headers?: Record<string, HeaderValue>;
  /** `null` clears a previously-set override; `undefined` leaves as-is. */
  readonly annotationPolicy?: AnnotationPolicy | null;
}

/**
 * Errors any GraphQL extension method may surface. `GraphqlIntrospectionError`
 * and `GraphqlExtractionError` are plugin-domain tagged errors that flow
 * directly to clients (4xx, each carrying its own `HttpApiSchema` status).
 * `StorageFailure` covers raw backend failures (`StorageError` plus
 * `UniqueViolationError`); the HTTP edge (`@executor/api`'s `withCapture`)
 * translates `StorageError` to the opaque `InternalError({ traceId })` at
 * Layer composition.
 */
export type GraphqlExtensionFailure =
  | GraphqlIntrospectionError
  | GraphqlExtractionError
  | StorageFailure;

export interface GraphqlPluginExtension {
  /** Add a GraphQL endpoint and register its operations as tools */
  readonly addSource: (
    config: GraphqlSourceConfig,
  ) => Effect.Effect<{ readonly toolCount: number }, GraphqlExtensionFailure>;

  /** Remove all tools from a previously added GraphQL source by namespace.
   *  `scope` pins the cleanup to the exact row — without it a shadowed
   *  outer-scope source with the same namespace could be wiped instead. */
  readonly removeSource: (
    namespace: string,
    scope: string,
  ) => Effect.Effect<void, StorageFailure>;

  /** Fetch the full stored source by namespace (or null if missing).
   *  When `scope` is provided it returns the exact row at that scope;
   *  when omitted the plugin defaults to the innermost scope
   *  (`ctx.scopes[0].id`). For fall-through reads across the executor's
   *  scope stack, use `executor.sources.*`. */
  readonly getSource: {
    (
      namespace: string,
      scope: string,
    ): Effect.Effect<StoredGraphqlSource | null, StorageFailure>;
    (
      namespace: string,
    ): Effect.Effect<StoredGraphqlSource | null, StorageFailure>;
  };

  /** Update config (endpoint, headers, annotation policy) for an
   *  existing GraphQL source. Does NOT re-introspect or re-register
   *  tools — just patches the stored values used at invoke time.
   *  When `scope` is provided it pins the mutation to a single row so
   *  shadowed rows at other scopes are untouched; when omitted the
   *  plugin defaults to the innermost scope (`ctx.scopes[0].id`). */
  readonly updateSource: {
    (
      namespace: string,
      scope: string,
      input: GraphqlUpdateSourceInput,
    ): Effect.Effect<void, StorageFailure>;
    (
      namespace: string,
      input: GraphqlUpdateSourceInput,
    ): Effect.Effect<void, StorageFailure>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a namespace from an endpoint URL */
const namespaceFromEndpoint = (endpoint: string): string => {
  try {
    const url = new URL(endpoint);
    return url.hostname.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  } catch {
    return "graphql";
  }
};

const formatTypeRef = (ref: IntrospectionTypeRef): string => {
  switch (ref.kind) {
    case "NON_NULL":
      return ref.ofType ? `${formatTypeRef(ref.ofType)}!` : "Unknown!";
    case "LIST":
      return ref.ofType ? `[${formatTypeRef(ref.ofType)}]` : "[Unknown]";
    default:
      return ref.name ?? "Unknown";
  }
};

const unwrapTypeName = (ref: IntrospectionTypeRef): string => {
  if (ref.name) return ref.name;
  if (ref.ofType) return unwrapTypeName(ref.ofType);
  return "Unknown";
};

const buildSelectionSet = (
  ref: IntrospectionTypeRef,
  types: ReadonlyMap<string, IntrospectionType>,
  depth: number,
  seen: Set<string>,
): string => {
  if (depth > 2) return "";

  const leafName = unwrapTypeName(ref);
  if (seen.has(leafName)) return "";

  const objectType = types.get(leafName);
  if (!objectType?.fields) return "";

  const kind = objectType.kind;
  if (kind === "SCALAR" || kind === "ENUM") return "";

  seen.add(leafName);

  const subFields = objectType.fields
    .filter((f) => !f.name.startsWith("__"))
    .slice(0, 12)
    .map((f) => {
      const sub = buildSelectionSet(f.type, types, depth + 1, seen);
      return sub ? `${f.name} ${sub}` : f.name;
    });

  seen.delete(leafName);

  return subFields.length > 0 ? `{ ${subFields.join(" ")} }` : "";
};

const buildOperationStringForField = (
  kind: GraphqlOperationKind,
  field: IntrospectionField,
  types: ReadonlyMap<string, IntrospectionType>,
): string => {
  const opType = kind === "query" ? "query" : "mutation";

  const varDefs = field.args.map((arg) => {
    const typeName = formatTypeRef(arg.type);
    return `$${arg.name}: ${typeName}`;
  });

  const argPasses = field.args.map((arg) => `${arg.name}: $${arg.name}`);
  const selectionSet = buildSelectionSet(field.type, types, 0, new Set());

  const varDefsStr = varDefs.length > 0 ? `(${varDefs.join(", ")})` : "";
  const argPassStr = argPasses.length > 0 ? `(${argPasses.join(", ")})` : "";

  return `${opType}${varDefsStr} { ${field.name}${argPassStr}${selectionSet ? ` ${selectionSet}` : ""} }`;
};

interface PreparedOperation {
  readonly toolPath: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly binding: OperationBinding;
}

const prepareOperations = (
  fields: readonly ExtractedField[],
  introspection: IntrospectionResult,
): readonly PreparedOperation[] => {
  const typeMap = new Map<string, IntrospectionType>();
  for (const t of introspection.__schema.types) {
    typeMap.set(t.name, t);
  }

  const fieldMap = new Map<
    string,
    { kind: GraphqlOperationKind; field: IntrospectionField }
  >();
  const schema = introspection.__schema;
  for (const rootKind of ["query", "mutation"] as const) {
    const typeName =
      rootKind === "query" ? schema.queryType?.name : schema.mutationType?.name;
    if (!typeName) continue;
    const rootType = typeMap.get(typeName);
    if (!rootType?.fields) continue;
    for (const f of rootType.fields) {
      if (!f.name.startsWith("__")) {
        fieldMap.set(`${rootKind}.${f.name}`, { kind: rootKind, field: f });
      }
    }
  }

  return fields.map((extracted) => {
    const prefix = extracted.kind === "mutation" ? "mutation" : "query";
    const toolPath = `${prefix}.${extracted.fieldName}`;
    const description = Option.getOrElse(
      extracted.description,
      () =>
        `GraphQL ${extracted.kind}: ${extracted.fieldName} -> ${extracted.returnTypeName}`,
    );

    const key = `${extracted.kind}.${extracted.fieldName}`;
    const entry = fieldMap.get(key);
    const operationString = entry
      ? buildOperationStringForField(entry.kind, entry.field, typeMap)
      : `${extracted.kind} { ${extracted.fieldName} }`;

    const binding = new OperationBinding({
      kind: extracted.kind,
      fieldName: extracted.fieldName,
      operationString,
      variableNames: extracted.arguments.map((a) => a.name),
    });

    return {
      toolPath,
      description,
      inputSchema: Option.getOrUndefined(extracted.inputSchema),
      binding,
    };
  });
};

const DEFAULT_REQUIRE_APPROVAL_KINDS = new Set<GraphqlOperationKind>(["mutation"]);

const annotationsFor = (
  binding: OperationBinding,
  policy?: AnnotationPolicy | undefined,
): ToolAnnotations => {
  const requireSet = policy?.requireApprovalFor
    ? new Set<string>(policy.requireApprovalFor)
    : DEFAULT_REQUIRE_APPROVAL_KINDS;
  if (!requireSet.has(binding.kind)) return {};
  return {
    requiresApproval: true,
    approvalDescription: `${binding.kind} ${binding.fieldName}`,
  };
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export interface GraphqlPluginOptions {
  readonly httpClientLayer?: Layer.Layer<HttpClient.HttpClient>;
  /** If provided, source add/remove is mirrored to executor.jsonc
   *  (best-effort — file errors are logged, not raised). */
  readonly configFile?: ConfigFileSink;
}

const toGraphqlConfigEntry = (
  namespace: string,
  config: GraphqlSourceConfig,
): GraphqlConfigEntry => ({
  kind: "graphql",
  endpoint: config.endpoint,
  introspectionJson: config.introspectionJson,
  namespace,
  headers: headersToConfigValues(config.headers),
});

export const graphqlPlugin = definePlugin(
  (options?: GraphqlPluginOptions) => {
    const httpClientLayer = options?.httpClientLayer ?? FetchHttpClient.layer;

    return {
      id: "graphql" as const,
      schema: graphqlSchema,
      storage: (deps): GraphqlStore => makeDefaultGraphqlStore(deps),

      extension: (ctx) => {
        const resolveConfigHeaders = (
          headers: Record<string, HeaderValue> | undefined,
        ) =>
          Effect.gen(function* () {
            if (!headers) return undefined;
            const resolved = yield* resolveHeaders(headers, ctx.secrets);
            return Object.keys(resolved).length > 0 ? resolved : undefined;
          });

        const addSourceInternal = (config: GraphqlSourceConfig) =>
          ctx.transaction(
            Effect.gen(function* () {
              let introspectionResult: IntrospectionResult;
              if (config.introspectionJson) {
                introspectionResult = yield* parseIntrospectionJson(
                  config.introspectionJson,
                );
              } else {
                const resolved = yield* resolveConfigHeaders(config.headers);
                introspectionResult = yield* introspect(
                  config.endpoint,
                  resolved,
                ).pipe(Effect.provide(httpClientLayer));
              }

              const { result, definitions } = yield* extract(
                introspectionResult,
              );
              const namespace =
                config.namespace ?? namespaceFromEndpoint(config.endpoint);
              const prepared = prepareOperations(
                result.fields,
                introspectionResult,
              );

              const displayName = config.name?.trim() || namespace;
              const resolvedScope =
                config.scope ?? (ctx.scopes[0]!.id as string);

              // Persist the source + per-operation bindings first so any
              // subsequent core-source register collision rolls back both.
              const storedSource: StoredGraphqlSource = {
                namespace,
                scope: resolvedScope,
                name: displayName,
                endpoint: config.endpoint,
                headers: config.headers ?? {},
                ...(config.annotationPolicy
                  ? { annotationPolicy: config.annotationPolicy }
                  : {}),
              };

              const storedOps: StoredOperation[] = prepared.map((p) => ({
                toolId: `${namespace}.${p.toolPath}`,
                sourceId: namespace,
                binding: p.binding,
              }));

              yield* ctx.storage.upsertSource(storedSource, storedOps);

              yield* ctx.core.sources.register({
                id: namespace,
                scope: resolvedScope,
                kind: "graphql",
                name: displayName,
                url: config.endpoint,
                canRemove: true,
                canRefresh: false,
                canEdit: true,
                tools: prepared.map((p) => ({
                  name: p.toolPath,
                  description: p.description,
                  inputSchema: p.inputSchema,
                })),
              });

              if (Object.keys(definitions).length > 0) {
                yield* ctx.core.definitions.register({
                  sourceId: namespace,
                  scope: resolvedScope,
                  definitions,
                });
              }

              return { toolCount: prepared.length, namespace };
            }),
          );

        const configFile = options?.configFile;

        return {
          addSource: (config) =>
            addSourceInternal(config).pipe(
              Effect.tap((result) =>
                configFile
                  ? configFile.upsertSource(
                      toGraphqlConfigEntry(result.namespace, config),
                    )
                  : Effect.void,
              ),
              Effect.map(({ toolCount }) => ({ toolCount })),
            ),

          removeSource: (namespace, scope) =>
            Effect.gen(function* () {
              yield* ctx.transaction(
                Effect.gen(function* () {
                  yield* ctx.storage.removeSource(namespace, scope);
                  yield* ctx.core.sources.unregister(namespace);
                }),
              );
              if (configFile) {
                yield* configFile.removeSource(namespace);
              }
            }),

          getSource: ((
            namespace: string,
            scope?: string,
          ) =>
            ctx.storage.getSource(
              namespace,
              scope ?? (ctx.scopes[0]!.id as string),
            )) as GraphqlPluginExtension["getSource"],

          updateSource: ((
            namespace: string,
            scopeOrInput: string | GraphqlUpdateSourceInput,
            maybeInput?: GraphqlUpdateSourceInput,
          ) => {
            const [resolvedScope, input] =
              typeof scopeOrInput === "string"
                ? [scopeOrInput, maybeInput!]
                : [ctx.scopes[0]!.id as string, scopeOrInput];
            return ctx.storage.updateSourceMeta(namespace, resolvedScope, {
              name: input.name?.trim() || undefined,
              endpoint: input.endpoint,
              headers: input.headers,
              annotationPolicy: input.annotationPolicy,
            });
          }) as GraphqlPluginExtension["updateSource"],
        } satisfies GraphqlPluginExtension;
      },

      staticSources: (self) => [
        {
          id: "graphql",
          kind: "control",
          name: "GraphQL",
          tools: [
            {
              name: "addSource",
              description:
                "Add a GraphQL endpoint and register its operations as tools",
              inputSchema: {
                type: "object",
                properties: {
                  endpoint: { type: "string" },
                  name: { type: "string" },
                  introspectionJson: { type: "string" },
                  namespace: { type: "string" },
                  headers: { type: "object" },
                },
                required: ["endpoint"],
              },
              outputSchema: {
                type: "object",
                properties: {
                  toolCount: { type: "number" },
                },
                required: ["toolCount"],
              },
              // Static-tool callers don't name a scope. Default to the
              // outermost scope in the executor's stack — for a single-
              // scope executor that's the only scope; for a per-user
              // stack `[user, org]` it writes at `org` so the source is
              // visible across every user.
              handler: ({ ctx, args }) =>
                self.addSource({
                  ...(args as Omit<GraphqlSourceConfig, "scope">),
                  scope: ctx.scopes.at(-1)!.id as string,
                }),
            },
          ],
        },
      ],

      invokeTool: ({ ctx, toolRow, args }) =>
        Effect.gen(function* () {
          // toolRow.scope_id is the resolved owning scope of the tool
          // (innermost-wins from the executor's stack). The matching
          // graphql_operation + graphql_source rows live at the same
          // scope, so pin every store lookup to it instead of relying
          // on the scoped adapter's stack-wide fall-through.
          const toolScope = toolRow.scope_id as string;
          const op = yield* ctx.storage.getOperationByToolId(
            toolRow.id,
            toolScope,
          );
          if (!op) {
            return yield* Effect.fail(
              new Error(`No GraphQL operation found for tool "${toolRow.id}"`),
            );
          }
          const source = yield* ctx.storage.getSource(op.sourceId, toolScope);
          if (!source) {
            return yield* Effect.fail(
              new Error(`No GraphQL source found for "${op.sourceId}"`),
            );
          }

          const resolvedHeaders = yield* resolveHeaders(
            source.headers,
            ctx.secrets,
          );

          const result = yield* invokeWithLayer(
            op.binding,
            (args ?? {}) as Record<string, unknown>,
            source.endpoint,
            resolvedHeaders,
            httpClientLayer,
          );

          return result;
        }),

      resolveAnnotations: ({ ctx, sourceId, toolRows }) =>
        Effect.gen(function* () {
          // toolRows for a single (plugin_id, source_id) group can still
          // straddle multiple scopes when the source is shadowed (e.g. an
          // org-level GraphQL source plus a per-user override that
          // re-registers the same tool ids). Run one listOperationsBySource
          // per distinct scope so each lookup pins {source_id, scope_id}
          // and we don't fall through to the wrong scope's bindings. The
          // per-source annotation policy is also scope-owned — pin it the
          // same way so a user-scope override doesn't leak onto org-scope
          // tools (and vice versa).
          const scopes = new Set<string>();
          for (const row of toolRows as readonly ToolRow[]) {
            scopes.add(row.scope_id as string);
          }
          const byScope = new Map<
            string,
            {
              bindings: Map<string, OperationBinding>;
              policy: AnnotationPolicy | undefined;
            }
          >();
          for (const scope of scopes) {
            const ops = yield* ctx.storage.listOperationsBySource(
              sourceId,
              scope,
            );
            const bindings = new Map<string, OperationBinding>();
            for (const op of ops) bindings.set(op.toolId, op.binding);
            const source = yield* ctx.storage.getSource(sourceId, scope);
            byScope.set(scope, {
              bindings,
              policy: source?.annotationPolicy,
            });
          }

          const out: Record<string, ToolAnnotations> = {};
          for (const row of toolRows as readonly ToolRow[]) {
            const entry = byScope.get(row.scope_id as string);
            const binding = entry?.bindings.get(row.id);
            if (binding) out[row.id] = annotationsFor(binding, entry?.policy);
          }
          return out;
        }),

      removeSource: ({ ctx, sourceId, scope }) =>
        ctx.storage.removeSource(sourceId, scope),

      detect: ({ url }) =>
        Effect.gen(function* () {
          const trimmed = url.trim();
          if (!trimmed) return null;
          const parsed = yield* Effect.try(() => new URL(trimmed)).pipe(
            Effect.option,
          );
          if (parsed._tag === "None") return null;

          const ok = yield* introspect(trimmed).pipe(
            Effect.provide(httpClientLayer),
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false)),
          );

          if (!ok) return null;

          const name = namespaceFromEndpoint(trimmed);
          return new SourceDetectionResult({
            kind: "graphql",
            confidence: "high",
            endpoint: trimmed,
            name,
            namespace: name,
          });
        }),
    };
  },
);
