import {
  applyCookiePlacementsToHeaders,
  applyHttpQueryPlacementsToUrl,
  applyJsonBodyPlacements,
} from "@executor/codemode-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  createCatalogImportMetadata,
  createSourceCatalogSyncResult,
} from "@executor/source-core";
import type { Source } from "@executor/platform-sdk/schema";
import type {
  ExecutorSdkPlugin,
  ExecutorSdkPluginHost,
  ExecutorSourceConnector,
  SourcePluginRuntime,
} from "@executor/platform-sdk/plugins";
import {
  SecretMaterialResolverService,
  provideExecutorRuntime,
} from "@executor/platform-sdk/runtime";
import {
  deriveGraphqlNamespace,
  GraphqlConnectionAuthSchema,
  GraphqlStoredSourceDataSchema,
  type GraphqlConnectInput,
  type GraphqlSourceConfigPayload,
  type GraphqlStoredSourceData,
  type GraphqlUpdateSourceInput,
} from "@executor/plugin-graphql-shared";

import {
  createGraphqlCatalogFragment,
  type GraphqlCatalogOperationInput,
} from "./catalog";
import {
  compileGraphqlToolDefinitions,
  extractGraphqlManifest,
  GRAPHQL_INTROSPECTION_QUERY,
  buildGraphqlToolPresentation,
} from "./graphql-tools";
import {
  GraphqlToolProviderDataSchema,
  type GraphqlToolProviderData,
} from "./provider-data";

const decodeStoredSourceData = Schema.decodeUnknownSync(GraphqlStoredSourceDataSchema);
const decodeProviderData = Schema.decodeUnknownSync(GraphqlToolProviderDataSchema);

export type GraphqlSourceStorage = {
  get: (input: {
    scopeId: string;
    sourceId: string;
  }) => Effect.Effect<GraphqlStoredSourceData | null, Error, never>;
  put: (input: {
    scopeId: string;
    sourceId: string;
    value: GraphqlStoredSourceData;
  }) => Effect.Effect<void, Error, never>;
  remove?: (input: {
    scopeId: string;
    sourceId: string;
  }) => Effect.Effect<void, Error, never>;
};

export type GraphqlSdk = {
  getSourceConfig: (
    sourceId: Source["id"],
  ) => Effect.Effect<GraphqlSourceConfigPayload, Error>;
  createSource: (
    input: GraphqlConnectInput,
  ) => Effect.Effect<Source, Error>;
  updateSource: (
    input: GraphqlUpdateSourceInput,
  ) => Effect.Effect<Source, Error>;
  removeSource: (
    sourceId: Source["id"],
  ) => Effect.Effect<boolean, Error>;
};

const GraphqlExecutorAddInputSchema = Schema.Struct({
  kind: Schema.Literal("graphql"),
  name: Schema.String,
  endpoint: Schema.String,
  defaultHeaders: Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.String })),
  auth: GraphqlConnectionAuthSchema,
});

type GraphqlExecutorAddInput = typeof GraphqlExecutorAddInputSchema.Type;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asStringRecord = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry]] : [],
    ),
  );

const withoutUndefinedEntries = (
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );

const responseHeadersRecord = (response: Response): Record<string, string> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

const parseGraphqlResponseBody = async (
  response: Response,
): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
};

const resolveBearerToken = (
  auth: GraphqlStoredSourceData["auth"],
): Effect.Effect<string | null, Error, any> =>
  auth.kind === "none"
    ? Effect.succeed(null)
    : Effect.flatMap(SecretMaterialResolverService, (resolveSecretMaterial) =>
        resolveSecretMaterial({
          ref: auth.tokenSecretRef,
        }).pipe(Effect.map((token) => token.trim()))
      );

const resolveGraphqlHeaders = (
  stored: GraphqlStoredSourceData,
): Effect.Effect<Record<string, string>, Error, any> =>
  Effect.gen(function* () {
    const bearerToken = yield* resolveBearerToken(stored.auth);
    return {
      ...(stored.defaultHeaders ?? {}),
      ...(bearerToken
        ? {
            authorization: `Bearer ${bearerToken}`,
          }
        : {}),
    };
  });

const fetchGraphqlIntrospectionDocumentWithHeaders = (input: {
  endpoint: string;
  headers: Readonly<Record<string, string>>;
}): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      let response: Response;
      try {
        response = await fetch(input.endpoint, {
          method: "POST",
          headers: {
            accept: "application/graphql-response+json, application/json",
            "content-type": "application/json",
            ...input.headers,
          },
          body: JSON.stringify({ query: GRAPHQL_INTROSPECTION_QUERY }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (cause) {
        if (
          cause instanceof Error &&
          (cause.name === "AbortError" || cause.name === "TimeoutError")
        ) {
          throw new Error("GraphQL introspection timed out after 15000ms");
        }
        throw cause;
      }

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        throw new Error(
          `GraphQL introspection endpoint did not return JSON: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
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
    effect: input.definition.operationType === "query" ? "read" : "write",
    inputSchema: presentation.inputSchema,
    outputSchema: presentation.outputSchema,
    providerData: presentation.providerData as GraphqlToolProviderData,
  };
};

const storedSourceDataFromInput = (
  input: GraphqlConnectInput,
): GraphqlStoredSourceData =>
  decodeStoredSourceData({
    endpoint: input.endpoint.trim(),
    defaultHeaders: input.defaultHeaders,
    auth: input.auth,
  });

const sourceConfigFromStored = (
  source: Source,
  stored: GraphqlStoredSourceData,
): GraphqlSourceConfigPayload => ({
  name: source.name,
  endpoint: stored.endpoint,
  defaultHeaders: stored.defaultHeaders,
  auth: stored.auth,
});

const createGraphqlSourceSdk = (
  options: {
    storage: GraphqlSourceStorage;
  },
  host: ExecutorSdkPluginHost,
) => ({
  getSourceConfig: (sourceId: Source["id"]) =>
    Effect.gen(function* () {
      const source = yield* host.sources.get(sourceId);
      if (source.kind !== "graphql") {
        return yield* Effect.fail(
          new Error(`Source ${sourceId} is not a GraphQL source.`),
        );
      }

      const stored = yield* options.storage.get({
        scopeId: source.scopeId,
        sourceId: source.id,
      });
      if (stored === null) {
        return yield* Effect.fail(
          new Error(`GraphQL source storage missing for ${source.id}`),
        );
      }

      return sourceConfigFromStored(source, stored);
    }),
  createSource: (input: GraphqlConnectInput) =>
    Effect.gen(function* () {
      const stored = storedSourceDataFromInput(input);
      const createdSource = yield* host.sources.create({
        source: {
          name: input.name.trim(),
          kind: "graphql",
          status: "connected",
          enabled: true,
          namespace: deriveGraphqlNamespace({
            endpoint: input.endpoint,
            title: input.name,
          }),
        },
      });

      yield* options.storage.put({
        scopeId: createdSource.scopeId,
        sourceId: createdSource.id,
        value: stored,
      });

      return yield* host.sources.refreshCatalog(createdSource.id);
    }),
  updateSource: (input: GraphqlUpdateSourceInput) =>
    Effect.gen(function* () {
      const source = yield* host.sources.get(input.sourceId as Source["id"]);
      if (source.kind !== "graphql") {
        return yield* Effect.fail(
          new Error(`Source ${input.sourceId} is not a GraphQL source.`),
        );
      }

      const stored = storedSourceDataFromInput(input.config);
      const savedSource = yield* host.sources.save({
        ...source,
        name: input.config.name.trim(),
        namespace: deriveGraphqlNamespace({
          endpoint: input.config.endpoint,
          title: input.config.name,
        }),
      });

      yield* options.storage.put({
        scopeId: savedSource.scopeId,
        sourceId: savedSource.id,
        value: stored,
      });

      return yield* host.sources.refreshCatalog(savedSource.id);
    }),
  removeSource: (sourceId: Source["id"]) =>
    Effect.gen(function* () {
      const source = yield* host.sources.get(sourceId);
      if (source.kind !== "graphql") {
        return yield* Effect.fail(
          new Error(`Source ${sourceId} is not a GraphQL source.`),
        );
      }

      if (options.storage.remove) {
        yield* options.storage.remove({
          scopeId: source.scopeId,
          sourceId: source.id,
        });
      }

      return yield* host.sources.remove(source.id);
    }),
});

const graphqlSourceConnector = (
  options: {
    storage: GraphqlSourceStorage;
  },
): ExecutorSourceConnector<GraphqlExecutorAddInput> => ({
  kind: "graphql",
  displayName: "GraphQL",
  inputSchema: GraphqlExecutorAddInputSchema,
  inputSignatureWidth: 300,
  helpText: [
    "Point `endpoint` at the GraphQL HTTP endpoint and choose `auth.kind`.",
  ],
  createSource: ({ args, host }) =>
    createGraphqlSourceSdk(options, host).createSource(args),
});

const createGraphqlSourceRuntime = (
  options: {
    storage: GraphqlSourceStorage;
  },
): SourcePluginRuntime => ({
  kind: "graphql",
  displayName: "GraphQL",
  catalogKind: "imported",
  catalogIdentity: ({ source }) => ({
    kind: "graphql",
    sourceId: source.id,
  }),
  getIrModel: ({ source }) =>
    Effect.gen(function* () {
      const stored = yield* options.storage.get({
        scopeId: source.scopeId,
        sourceId: source.id,
      });

      if (stored === null) {
        return createSourceCatalogSyncResult({
          fragment: {
            version: "ir.v1.fragment",
          },
          importMetadata: {
            ...createCatalogImportMetadata({
              source,
              pluginKey: "graphql",
            }),
            importerVersion: "ir.v1.graphql",
            sourceConfigHash: "missing",
          },
          sourceHash: null,
        });
      }

      const headers = yield* resolveGraphqlHeaders(stored);
      const graphqlDocument = yield* fetchGraphqlIntrospectionDocumentWithHeaders({
        endpoint: stored.endpoint,
        headers,
      });
      const manifest = yield* extractGraphqlManifest(source.name, graphqlDocument);
      const definitions = yield* Effect.sync(() =>
        compileGraphqlToolDefinitions(manifest),
      );
      const operations = definitions.map((definition) =>
        graphqlCatalogOperationFromDefinition({
          definition,
          manifest,
        }),
      );
      const now = Date.now();

      return createSourceCatalogSyncResult({
        fragment: createGraphqlCatalogFragment({
          source,
          documents: [
            {
              documentKind: "graphql_introspection",
              documentKey: stored.endpoint,
              contentText: graphqlDocument,
              fetchedAt: now,
            },
          ],
          operations,
        }),
        importMetadata: {
          ...createCatalogImportMetadata({
            source,
            pluginKey: "graphql",
          }),
          importerVersion: "ir.v1.graphql",
        },
        sourceHash: manifest.sourceHash,
      });
    }),
  invoke: (input) =>
    Effect.gen(function* () {
      const stored = yield* options.storage.get({
        scopeId: input.source.scopeId,
        sourceId: input.source.id,
      });
      if (stored === null) {
        return yield* Effect.fail(
          new Error(`GraphQL source storage missing for ${input.source.id}`),
        );
      }

      const providerData = decodeProviderData(
        input.executable.binding,
      ) as GraphqlToolProviderData;
      const args = asRecord(input.args);
      const headers = {
        "content-type": "application/json",
        ...(yield* resolveGraphqlHeaders(stored)),
        ...asStringRecord(args.headers),
      };
      const endpoint = applyHttpQueryPlacementsToUrl({
        url: stored.endpoint,
      }).toString();

      const isRawRequest =
        providerData.toolKind === "request"
        || typeof providerData.operationDocument !== "string"
        || providerData.operationDocument.trim().length === 0;
      const query = isRawRequest
        ? (() => {
            const value = asString(args.query);
            if (value === null) {
              throw new Error("GraphQL request tools require args.query");
            }
            return value;
          })()
        : providerData.operationDocument!;
      const variables = isRawRequest
        ? args.variables !== undefined
          ? asRecord(args.variables)
          : undefined
        : withoutUndefinedEntries(
            Object.fromEntries(
              Object.entries(args).filter(([key]) => key !== "headers"),
            ),
          );
      const operationName = isRawRequest
        ? (asString(args.operationName) ?? undefined)
        : (providerData.operationName ?? undefined);

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(endpoint, {
            method: "POST",
            headers: applyCookiePlacementsToHeaders({
              headers,
              cookies: {},
            }),
            body: JSON.stringify(
              applyJsonBodyPlacements({
                body: {
                  query,
                  ...(variables ? { variables } : {}),
                  ...(operationName ? { operationName } : {}),
                },
                bodyValues: {},
                label: `GraphQL invocation ${stored.endpoint}`,
              }),
            ),
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      const body = yield* Effect.tryPromise({
        try: () => parseGraphqlResponseBody(response),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      const bodyRecord = asRecord(body);
      const hasErrors = Array.isArray(bodyRecord.errors) && bodyRecord.errors.length > 0;

      return {
        data: response.ok ? (bodyRecord.data ?? body) : null,
        error:
          response.ok && !hasErrors
            ? null
            : bodyRecord.errors ?? body,
        headers: responseHeadersRecord(response),
        status: response.status,
      };
    }),
});

export const graphqlSdkPlugin = (options: {
  storage: GraphqlSourceStorage;
}): ExecutorSdkPlugin<"graphql", GraphqlSdk> => ({
  key: "graphql",
  sources: [createGraphqlSourceRuntime(options)],
  sourceConnectors: [graphqlSourceConnector(options)],
  extendExecutor: ({ host, executor }) => {
    const sourceSdk = createGraphqlSourceSdk(options, host);
    const provideRuntime = <A>(
      effect: Effect.Effect<A, Error, any>,
    ): Effect.Effect<A, Error, never> =>
      provideExecutorRuntime(effect, executor.runtime);

    return {
      getSourceConfig: (sourceId) =>
        provideRuntime(sourceSdk.getSourceConfig(sourceId)),
      createSource: (input) =>
        provideRuntime(sourceSdk.createSource(input)),
      updateSource: (input) =>
        provideRuntime(sourceSdk.updateSource(input)),
      removeSource: (sourceId) =>
        provideRuntime(sourceSdk.removeSource(sourceId)),
    };
  },
});
