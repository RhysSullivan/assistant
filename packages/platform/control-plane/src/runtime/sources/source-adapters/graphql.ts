import {
  applyCookiePlacementsToHeaders,
  applyHttpQueryPlacementsToUrl,
  applyJsonBodyPlacements,
} from "@executor/codemode-core";
import type { GraphqlToolProviderData } from "@executor/codemode-graphql";
import {
  buildGraphqlToolPresentation,
  compileGraphqlToolDefinitions,
  extractGraphqlManifest,
  GRAPHQL_INTROSPECTION_QUERY,
} from "../graphql-tools";
import type { Source } from "#schema";
import { StringMapSchema } from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  createCatalogImportMetadata,
  createGraphqlCatalogFragment,
  type GraphqlCatalogOperationInput,
} from "@executor/catalog-builders";
import { createSourceCatalogSyncResult } from "../catalog-sync-result";
import type { SourceAdapter } from "./types";
import {
  ConnectHttpAuthSchema,
  ConnectHttpImportAuthSchema,
  decodeBindingConfig,
  decodeSourceBindingPayload,
  emptySourceBindingState,
  encodeBindingConfig,
  isSourceCredentialRequiredError,
  OptionalNullableStringSchema,
  SourceCredentialRequiredError,
  SourceConnectCommonFieldsSchema,
} from "./shared";

const GraphqlConnectPayloadSchema = Schema.extend(
  SourceConnectCommonFieldsSchema,
  Schema.extend(
    ConnectHttpImportAuthSchema,
    Schema.Struct({
      kind: Schema.Literal("graphql"),
      auth: Schema.optional(ConnectHttpAuthSchema),
    }),
  ),
);

const GraphqlExecutorAddInputSchema = Schema.extend(
  ConnectHttpImportAuthSchema,
  Schema.Struct({
    kind: Schema.Literal("graphql"),
    endpoint: Schema.String,
    name: OptionalNullableStringSchema,
    namespace: OptionalNullableStringSchema,
    auth: Schema.optional(ConnectHttpAuthSchema),
  }),
);

const GraphqlBindingConfigSchema = Schema.Struct({
  defaultHeaders: Schema.NullOr(StringMapSchema),
});

type GraphqlBindingConfig = typeof GraphqlBindingConfigSchema.Type;

const GraphqlSourceBindingPayloadSchema = Schema.Struct({
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
});

const GRAPHQL_BINDING_CONFIG_VERSION = 1;

const bindingHasAnyField = (
  value: unknown,
  fields: readonly string[],
): boolean =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && fields.some((field) => Object.prototype.hasOwnProperty.call(value, field));

const graphqlBindingConfigFromSource = (
  source: Pick<Source, "id" | "bindingVersion" | "binding">,
): Effect.Effect<GraphqlBindingConfig, Error, never> =>
  Effect.gen(function* () {
    if (bindingHasAnyField(source.binding, ["transport", "queryParams", "headers"])) {
      return yield* Effect.fail(
        new Error("GraphQL sources cannot define MCP transport settings"),
      );
    }
    if (bindingHasAnyField(source.binding, ["specUrl"])) {
      return yield* Effect.fail(new Error("GraphQL sources cannot define specUrl"));
    }

    const bindingConfig = yield* decodeSourceBindingPayload({
      sourceId: source.id,
      label: "GraphQL",
      version: source.bindingVersion,
      expectedVersion: GRAPHQL_BINDING_CONFIG_VERSION,
      schema: GraphqlSourceBindingPayloadSchema,
      value: source.binding,
      allowedKeys: ["defaultHeaders"],
    });

    return {
      defaultHeaders: bindingConfig.defaultHeaders ?? null,
    } satisfies GraphqlBindingConfig;
  });

const fetchGraphqlIntrospectionDocumentWithHeaders = (input: {
  url: string;
  headers?: Readonly<Record<string, string>>;
  queryParams?: Readonly<Record<string, string>>;
  cookies?: Readonly<Record<string, string>>;
  bodyValues?: Readonly<Record<string, string>>;
}): Effect.Effect<string, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        applyHttpQueryPlacementsToUrl({
          url: input.url,
          queryParams: input.queryParams,
        }).toString(),
        {
        method: "POST",
          headers: applyCookiePlacementsToHeaders({
            headers: {
              "content-type": "application/json",
              ...(input.headers ?? {}),
            },
            cookies: input.cookies,
          }),
          body: JSON.stringify(
            applyJsonBodyPlacements({
              body: {
                query: GRAPHQL_INTROSPECTION_QUERY,
                operationName: "IntrospectionQuery",
              },
              bodyValues: input.bodyValues,
              label: `GraphQL introspection ${input.url}`,
            }),
          ),
        },
      );
      const text = await response.text();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (cause) {
        throw new Error(
          `GraphQL introspection endpoint did not return JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new SourceCredentialRequiredError(
            "import",
            `GraphQL introspection requires credentials (status ${response.status})`,
          );
        }
        throw new Error(
          `GraphQL introspection failed with status ${response.status}`,
        );
      }

      return JSON.stringify(parsed, null, 2);
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

const graphqlCatalogOperationFromDefinition = (input: {
  definition: ReturnType<typeof compileGraphqlToolDefinitions>[number];
  manifest: Parameters<typeof buildGraphqlToolPresentation>[0]["manifest"];
}): GraphqlCatalogOperationInput => {
  const presentation = buildGraphqlToolPresentation({
    manifest: input.manifest,
    definition: input.definition,
  });

  return {
    toolId: input.definition.toolId,
    title: input.definition.name,
    description: input.definition.description,
    effect:
      input.definition.operationType === "query"
        ? "read"
        : "write",
    inputSchema: presentation.inputSchema,
    outputSchema: presentation.outputSchema,
    providerData: presentation.providerData as GraphqlToolProviderData,
  };
};

export const graphqlSourceAdapter: SourceAdapter = {
  key: "graphql",
  displayName: "GraphQL",
  family: "http_api",
  bindingConfigVersion: GRAPHQL_BINDING_CONFIG_VERSION,
  providerKey: "generic_graphql",
  defaultImportAuthPolicy: "reuse_runtime",
  connectPayloadSchema: GraphqlConnectPayloadSchema,
  executorAddInputSchema: GraphqlExecutorAddInputSchema,
  executorAddHelpText: [
    "endpoint is the GraphQL HTTP endpoint.",
  ],
  executorAddInputSignatureWidth: 320,
  serializeBindingConfig: (source) =>
    encodeBindingConfig({
      adapterKey: "graphql",
      version: GRAPHQL_BINDING_CONFIG_VERSION,
      payloadSchema: GraphqlBindingConfigSchema,
      payload: Effect.runSync(graphqlBindingConfigFromSource(source)),
    }),
  deserializeBindingConfig: ({ id, bindingConfigJson }) =>
    Effect.map(
      decodeBindingConfig({
        sourceId: id,
        label: "GraphQL",
        adapterKey: "graphql",
        version: GRAPHQL_BINDING_CONFIG_VERSION,
        payloadSchema: GraphqlBindingConfigSchema,
        value: bindingConfigJson,
      }),
      ({ version, payload }) => ({
        version,
        payload,
      }),
    ),
  bindingStateFromSource: (source) =>
    Effect.map(graphqlBindingConfigFromSource(source), (bindingConfig) => ({
        ...emptySourceBindingState,
        defaultHeaders: bindingConfig.defaultHeaders,
      }),
    ),
  sourceConfigFromSource: (source) =>
    Effect.runSync(
      Effect.map(graphqlBindingConfigFromSource(source), (bindingConfig) => ({
        kind: "graphql",
        endpoint: source.endpoint,
        defaultHeaders: bindingConfig.defaultHeaders,
      })),
    ),
  validateSource: (source) =>
    Effect.gen(function* () {
      const bindingConfig = yield* graphqlBindingConfigFromSource(source);

      return {
        ...source,
        bindingVersion: GRAPHQL_BINDING_CONFIG_VERSION,
        binding: {
          defaultHeaders: bindingConfig.defaultHeaders,
        },
      };
    }),
  shouldAutoProbe: (source) =>
    source.enabled && (source.status === "draft" || source.status === "probing"),
  syncCatalog: ({ source, resolveAuthMaterialForSlot }) =>
    Effect.gen(function* () {
      const bindingConfig = yield* graphqlBindingConfigFromSource(source);
      const auth = yield* resolveAuthMaterialForSlot("import");
      const graphqlDocument = yield* fetchGraphqlIntrospectionDocumentWithHeaders(
        {
          url: source.endpoint,
          headers: {
            ...(bindingConfig.defaultHeaders ?? {}),
            ...auth.headers,
          },
          queryParams: auth.queryParams,
          cookies: auth.cookies,
          bodyValues: auth.bodyValues,
        },
      ).pipe(
        Effect.withSpan("graphql.introspection.fetch", {
          kind: "client",
          attributes: {
            "executor.source.id": source.id,
            "executor.source.endpoint": source.endpoint,
          },
        }),
        Effect.mapError(
          (cause) =>
            isSourceCredentialRequiredError(cause)
              ? cause
              : new Error(
                `Failed fetching GraphQL introspection for ${source.id}: ${cause.message}`,
              ),
        ),
      );

      const manifest = yield* extractGraphqlManifest(
        source.name,
        graphqlDocument,
      ).pipe(
        Effect.withSpan("graphql.manifest.extract", {
          attributes: {
            "executor.source.id": source.id,
          },
        }),
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );
      yield* Effect.annotateCurrentSpan("graphql.tool.count", manifest.tools.length);

      const definitions = yield* Effect.sync(() => compileGraphqlToolDefinitions(manifest)).pipe(
        Effect.withSpan("graphql.definitions.compile", {
          attributes: {
            "executor.source.id": source.id,
            "graphql.tool.count": manifest.tools.length,
          },
        }),
      );
      yield* Effect.annotateCurrentSpan("graphql.definition.count", definitions.length);
      const operations = yield* Effect.sync(() =>
        definitions.map((definition) =>
          graphqlCatalogOperationFromDefinition({
            definition,
            manifest,
          })
        )
      ).pipe(
        Effect.withSpan("graphql.operations.build", {
          attributes: {
            "executor.source.id": source.id,
            "graphql.definition.count": definitions.length,
          },
        }),
      );
      const now = Date.now();
      const fragment = yield* Effect.sync(() =>
        createGraphqlCatalogFragment({
          source,
          documents: [{
            documentKind: "graphql_introspection",
            documentKey: source.endpoint,
            contentText: graphqlDocument,
            fetchedAt: now,
          }],
          operations,
        })
      ).pipe(
        Effect.withSpan("graphql.snapshot.build", {
          attributes: {
            "executor.source.id": source.id,
            "graphql.operation.count": operations.length,
          },
        }),
      );

      return createSourceCatalogSyncResult({
        fragment,
        importMetadata: createCatalogImportMetadata({
          source,
          adapterKey: "graphql",
        }),
        sourceHash: manifest.sourceHash,
      });
    }).pipe(
      Effect.withSpan("graphql.syncCatalog", {
        attributes: {
          "executor.source.id": source.id,
          "executor.source.endpoint": source.endpoint,
        },
      }),
    ),
};
