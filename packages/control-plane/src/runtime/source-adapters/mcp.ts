import {
  makeToolInvokerFromTools,
} from "@executor/codemode-core";
import {
  createMcpToolsFromManifest,
  createSdkMcpConnector,
  discoverMcpToolsFromConnector,
  type McpToolManifest,
  type McpToolManifestEntry,
} from "@executor/codemode-mcp";
import type { SqlControlPlaneRows } from "#persistence";
import type {
  Source,
  SourceRecipeRevisionId,
  StoredSourceRecipeOperationRecord,
} from "#schema";
import {
  SourceTransportSchema,
  StringMapSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  contentHash,
  normalizeSearchText,
  persistRecipeMaterialization,
  type SourceRecipeMaterialization,
} from "../source-recipe-support";
import { namespaceFromSourceName } from "../source-names";
import type { SourceAdapter, SourceAdapterMaterialization } from "./types";
import {
  createStandardToolDescriptor,
  decodeBindingConfig,
  emptySourceBindingState,
  encodeBindingConfig,
  McpConnectFieldsSchema,
  OptionalNullableStringSchema,
  parseJsonValue,
  SourceConnectCommonFieldsSchema,
} from "./shared";

const McpConnectPayloadSchema = Schema.extend(
  SourceConnectCommonFieldsSchema,
  Schema.extend(
    McpConnectFieldsSchema,
    Schema.Struct({
      kind: Schema.Literal("mcp"),
    }),
  ),
);

const McpExecutorAddInputSchema = Schema.Struct({
  kind: Schema.optional(Schema.Literal("mcp")),
  endpoint: Schema.String,
  name: OptionalNullableStringSchema,
  namespace: OptionalNullableStringSchema,
});

const McpBindingConfigSchema = Schema.Struct({
  adapterKey: Schema.Literal("mcp"),
  transport: Schema.NullOr(SourceTransportSchema),
  queryParams: Schema.NullOr(StringMapSchema),
  headers: Schema.NullOr(StringMapSchema),
});

const McpToolProviderDataSchema = Schema.Struct({
  kind: Schema.Literal("mcp"),
  toolId: Schema.String,
  toolName: Schema.String,
  description: Schema.NullOr(Schema.String),
});

const decodeMcpToolProviderDataJson = Schema.decodeUnknownEither(
  Schema.parseJson(McpToolProviderDataSchema),
);

const toMcpRecipeOperationRecord = (input: {
  recipeRevisionId: SourceRecipeRevisionId;
  entry: McpToolManifestEntry;
  now: number;
}): StoredSourceRecipeOperationRecord => ({
  id: `src_recipe_op_${crypto.randomUUID()}`,
  recipeRevisionId: input.recipeRevisionId,
  operationKey: input.entry.toolId,
  transportKind: "mcp",
  toolId: input.entry.toolId,
  title: input.entry.toolName,
  description: input.entry.description ?? null,
  operationKind: "unknown",
  searchText: normalizeSearchText(
    input.entry.toolId,
    input.entry.toolName,
    input.entry.description ?? undefined,
    "mcp",
  ),
  inputSchemaJson: input.entry.inputSchemaJson ?? null,
  outputSchemaJson: input.entry.outputSchemaJson ?? null,
  providerKind: "mcp",
  providerDataJson: JSON.stringify({
    kind: "mcp",
    toolId: input.entry.toolId,
    toolName: input.entry.toolName,
    description: input.entry.description ?? null,
  }),
  createdAt: input.now,
  updatedAt: input.now,
});

export const persistMcpRecipeRevisionFromManifestEntries = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  manifestEntries: readonly McpToolManifestEntry[];
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    yield* persistRecipeMaterialization({
      rows: input.rows,
      source: input.source,
      materialization: materializationFromMcpManifestEntries({
        recipeRevisionId: "src_recipe_rev_materialization" as SourceRecipeRevisionId,
        endpoint: input.source.endpoint,
        manifestEntries: input.manifestEntries,
      }),
    });
  });

const materializationFromMcpManifestEntries = (input: {
  recipeRevisionId: SourceRecipeRevisionId;
  endpoint: string;
  manifestEntries: readonly McpToolManifestEntry[];
}): SourceRecipeMaterialization => {
  const now = Date.now();
  const manifest: McpToolManifest = {
    version: 1,
    tools: input.manifestEntries,
  };
  const manifestJson = JSON.stringify(manifest);
  const manifestHash = contentHash(manifestJson);

  return {
    manifestJson,
    manifestHash,
    sourceHash: manifestHash,
    documents: [
      {
        id: `src_recipe_doc_${crypto.randomUUID()}`,
        recipeRevisionId: input.recipeRevisionId,
        documentKind: "mcp_manifest",
        documentKey: input.endpoint,
        contentText: manifestJson,
        contentHash: manifestHash,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
    schemaBundles: [],
    operations: input.manifestEntries.map((entry) =>
      toMcpRecipeOperationRecord({
        recipeRevisionId: input.recipeRevisionId,
        entry,
        now,
      })
    ),
  };
};

export const mcpSourceAdapter: SourceAdapter = {
  key: "mcp",
  displayName: "MCP",
  family: "mcp",
  providerKey: "generic_mcp",
  defaultImportAuthPolicy: "reuse_runtime",
  primaryDocumentKind: "mcp_manifest",
  primarySchemaBundleKind: null,
  connectPayloadSchema: McpConnectPayloadSchema,
  executorAddInputSchema: McpExecutorAddInputSchema,
  executorAddHelpText: [
    'Omit kind or set kind: "mcp". endpoint is the MCP server URL.',
  ],
  executorAddInputSignatureWidth: 240,
  serializeBindingConfig: (source) =>
    encodeBindingConfig(McpBindingConfigSchema, {
      adapterKey: "mcp",
      transport: source.transport,
      queryParams: source.queryParams,
      headers: source.headers,
    }),
  deserializeBindingConfig: ({ id, bindingConfigJson }) =>
    Effect.map(
      decodeBindingConfig({
        sourceId: id,
        label: "MCP",
        schema: McpBindingConfigSchema,
        value: bindingConfigJson,
      }),
      (bindingConfig) => ({
        ...emptySourceBindingState,
        transport: bindingConfig.transport,
        queryParams: bindingConfig.queryParams,
        headers: bindingConfig.headers,
      }),
    ),
  sourceConfigFromSource: (source) => ({
    kind: "mcp",
    endpoint: source.endpoint,
    transport: source.transport,
    queryParams: source.queryParams,
    headers: source.headers,
  }),
  validateSource: (source) =>
    Effect.gen(function* () {
      if (source.specUrl !== null) {
        return yield* Effect.fail(new Error("MCP sources cannot define specUrl"));
      }

      if (source.defaultHeaders !== null) {
        return yield* Effect.fail(
          new Error("MCP sources cannot define HTTP default headers"),
        );
      }

      return source;
    }),
  shouldAutoProbe: () => false,
  parseManifest: ({ source, manifestJson }) =>
    parseJsonValue<McpToolManifest>({
      label: `MCP manifest for ${source.id}`,
      value: manifestJson,
    }),
  describePersistedOperation: ({ operation, path }) =>
    Effect.gen(function* () {
      const decoded = operation.providerDataJson
        ? decodeMcpToolProviderDataJson(operation.providerDataJson)
        : null;
      if (decoded && decoded._tag === "Left") {
        return yield* Effect.fail(
          new Error(`Invalid MCP provider data for ${path}`),
        );
      }

      const providerData = decoded?._tag === "Right" ? decoded.right : null;

      return {
        method: null,
        pathTemplate: null,
        rawToolId: providerData?.toolId ?? null,
        operationId: null,
        group: null,
        leaf: null,
        tags: [],
        searchText: normalizeSearchText(
          path,
          operation.toolId,
          providerData?.toolName ?? operation.title ?? undefined,
          providerData?.description ?? operation.description ?? undefined,
          operation.searchText,
        ),
        interaction: "auto",
        approvalLabel: null,
      } as const;
    }),
  createToolDescriptor: ({ source, operation, path, includeSchemas, schemaBundleId }) =>
    createStandardToolDescriptor({
      source,
      operation,
      path,
      includeSchemas,
      interaction: "auto",
      schemaBundleId,
    }),
  materializeSource: ({ source, resolveAuthMaterialForSlot }) =>
    Effect.gen(function* () {
      const auth = yield* resolveAuthMaterialForSlot("import");
      const connector = yield* Effect.try({
        try: () =>
          createSdkMcpConnector({
            endpoint: source.endpoint,
            transport: source.transport ?? undefined,
            queryParams: source.queryParams ?? undefined,
            headers: {
              ...(source.headers ?? {}),
              ...auth.headers,
            },
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      const discovered = yield* discoverMcpToolsFromConnector({
        connect: connector,
        namespace: source.namespace ?? namespaceFromSourceName(source.name),
        sourceKey: source.id,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new Error(
              `Failed discovering MCP tools for ${source.id}: ${cause.message}`,
            ),
        ),
      );

      return materializationFromMcpManifestEntries({
        recipeRevisionId: "src_recipe_rev_materialization" as SourceRecipeRevisionId,
        endpoint: source.endpoint,
        manifestEntries: discovered.manifest.tools,
      }) satisfies SourceAdapterMaterialization;
    }),
  invokePersistedTool: ({
    source,
    path,
    manifestJson,
    auth,
    args,
    context,
    onElicitation,
  }) =>
    Effect.gen(function* () {
      const manifest = yield* parseJsonValue<McpToolManifest>({
        label: `MCP manifest for ${source.id}`,
        value: manifestJson,
      });
      if (manifest === null) {
        return yield* Effect.fail(
          new Error(`Missing MCP manifest for ${source.id}`),
        );
      }

      const tools = createMcpToolsFromManifest({
        manifest,
        connect: createSdkMcpConnector({
          endpoint: source.endpoint,
          transport: source.transport ?? undefined,
          queryParams: source.queryParams ?? undefined,
          headers: {
            ...(source.headers ?? {}),
            ...auth.headers,
          },
        }),
        namespace: source.namespace ?? namespaceFromSourceName(source.name),
        sourceKey: source.id,
      });

      return yield* makeToolInvokerFromTools({
        tools,
        onElicitation,
      }).invoke({
        path,
        args,
        context,
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );
    }),
};
