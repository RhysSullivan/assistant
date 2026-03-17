import {
  applyCookiePlacementsToHeaders,
  type ToolExecutionContext,
  type ToolInput,
  type ToolPath,
} from "@executor/codemode-core";
import { createSdkMcpConnector } from "./connection";
import {
  createMcpToolsFromManifest,
  discoverMcpToolsFromConnector,
  type McpToolManifest,
  type McpToolManifestEntry,
} from "./tools";
import {
  createMcpCatalogFragment,
  type McpCatalogOperationInput,
} from "./catalog";
import type { McpServerMetadata } from "./manifest";
import {
  contentHash,
  createSourceCatalogSyncResult,
  decodeBindingConfig,
  decodeExecutableBindingPayload,
  decodeSourceBindingPayload,
  emptySourceBindingState,
  encodeBindingConfig,
  McpConnectFieldsSchema,
  OptionalNullableStringSchema,
  SourceConnectCommonFieldsSchema,
  SourceTransportSchema,
  StringMapSchema,
  createCatalogImportMetadata,
  EXECUTABLE_BINDING_VERSION,
  type Source,
  type SourceAdapter,
  type SourceCatalogSyncResult,
} from "@executor/source-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const headersWithAuthCookies = (input: {
  headers: Readonly<Record<string, string>>;
  authHeaders: Readonly<Record<string, string>>;
  authCookies: Readonly<Record<string, string>>;
}): Record<string, string> =>
  applyCookiePlacementsToHeaders({
    headers: {
      ...input.headers,
      ...input.authHeaders,
    },
    cookies: input.authCookies,
  });

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asToolPath = (value: string): ToolPath => value as ToolPath;

const namespaceFromSourceName = (name: string): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

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
  transport: Schema.NullOr(SourceTransportSchema),
  queryParams: Schema.NullOr(StringMapSchema),
  headers: Schema.NullOr(StringMapSchema),
});

type McpBindingConfig = typeof McpBindingConfigSchema.Type;

const McpSourceBindingPayloadSchema = Schema.Struct({
  transport: Schema.optional(Schema.NullOr(SourceTransportSchema)),
  queryParams: Schema.optional(Schema.NullOr(StringMapSchema)),
  headers: Schema.optional(Schema.NullOr(StringMapSchema)),
});

const McpExecutableBindingSchema = Schema.Struct({
  toolId: Schema.String,
  toolName: Schema.String,
  displayTitle: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  annotations: Schema.NullOr(Schema.Unknown),
  execution: Schema.NullOr(Schema.Unknown),
  icons: Schema.NullOr(Schema.Unknown),
  meta: Schema.NullOr(Schema.Unknown),
  rawTool: Schema.NullOr(Schema.Unknown),
  server: Schema.NullOr(Schema.Unknown),
});

type McpExecutableBinding = typeof McpExecutableBindingSchema.Type;

const MCP_BINDING_CONFIG_VERSION = 1;

const bindingHasAnyField = (
  value: unknown,
  fields: readonly string[],
): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  fields.some((field) => Object.prototype.hasOwnProperty.call(value, field));

const mcpBindingConfigFromSource = (
  source: Pick<Source, "id" | "bindingVersion" | "binding">,
): Effect.Effect<McpBindingConfig, Error, never> =>
  Effect.gen(function* () {
    if (bindingHasAnyField(source.binding, ["specUrl"])) {
      return yield* Effect.fail(new Error("MCP sources cannot define specUrl"));
    }
    if (bindingHasAnyField(source.binding, ["defaultHeaders"])) {
      return yield* Effect.fail(
        new Error("MCP sources cannot define HTTP source settings"),
      );
    }

    const bindingConfig = yield* decodeSourceBindingPayload({
      sourceId: source.id,
      label: "MCP",
      version: source.bindingVersion,
      expectedVersion: MCP_BINDING_CONFIG_VERSION,
      schema: McpSourceBindingPayloadSchema,
      value: source.binding,
      allowedKeys: ["transport", "queryParams", "headers"],
    });

    return {
      transport: bindingConfig.transport ?? null,
      queryParams: bindingConfig.queryParams ?? null,
      headers: bindingConfig.headers ?? null,
    } satisfies McpBindingConfig;
  });

const effectFromMcpManifestEntry = (
  entry: McpToolManifestEntry,
): McpCatalogOperationInput["effect"] =>
  entry.annotations?.readOnlyHint === true ? "read" : "write";

const mcpCatalogOperationFromManifestEntry = (input: {
  entry: McpToolManifestEntry;
  server: McpServerMetadata | null | undefined;
}): McpCatalogOperationInput => ({
  toolId: input.entry.toolId,
  title: input.entry.displayTitle ?? input.entry.title ?? input.entry.toolName,
  description: input.entry.description ?? null,
  effect: effectFromMcpManifestEntry(input.entry),
  inputSchema: input.entry.inputSchema,
  outputSchema: input.entry.outputSchema,
  providerData: {
    toolId: input.entry.toolId,
    toolName: input.entry.toolName,
    displayTitle:
      input.entry.displayTitle ?? input.entry.title ?? input.entry.toolName,
    title: input.entry.title ?? null,
    description: input.entry.description ?? null,
    annotations: input.entry.annotations ?? null,
    execution: input.entry.execution ?? null,
    icons: input.entry.icons ?? null,
    meta: input.entry.meta ?? null,
    rawTool: input.entry.rawTool ?? null,
    server: input.server ?? null,
  },
});

export const catalogSyncResultFromMcpManifest = (input: {
  source: Source;
  endpoint: string;
  manifest: McpToolManifest;
}): SourceCatalogSyncResult => {
  const now = Date.now();
  const manifestJson = JSON.stringify(input.manifest);
  const manifestHash = contentHash(manifestJson);

  return createSourceCatalogSyncResult({
    fragment: createMcpCatalogFragment({
      source: input.source,
      documents: [
        {
          documentKind: "mcp_manifest",
          documentKey: input.endpoint,
          contentText: manifestJson,
          fetchedAt: now,
        },
      ],
      operations: input.manifest.tools.map((entry) =>
        mcpCatalogOperationFromManifestEntry({
          entry,
          server: input.manifest.server,
        }),
      ),
    }),
    importMetadata: createCatalogImportMetadata({
      source: input.source,
      adapterKey: "mcp",
    }),
    sourceHash: manifestHash,
  });
};

export const mcpSourceAdapter: SourceAdapter = {
  key: "mcp",
  displayName: "MCP",
  catalogKind: "imported",
  connectStrategy: "interactive",
  credentialStrategy: "adapter_defined",
  bindingConfigVersion: MCP_BINDING_CONFIG_VERSION,
  providerKey: "generic_mcp",
  defaultImportAuthPolicy: "reuse_runtime",
  connectPayloadSchema: McpConnectPayloadSchema,
  executorAddInputSchema: McpExecutorAddInputSchema,
  executorAddHelpText: [
    'Omit kind or set kind: "mcp". endpoint is the MCP server URL.',
  ],
  executorAddInputSignatureWidth: 240,
  serializeBindingConfig: (source) =>
    encodeBindingConfig({
      adapterKey: "mcp",
      version: MCP_BINDING_CONFIG_VERSION,
      payloadSchema: McpBindingConfigSchema,
      payload: Effect.runSync(mcpBindingConfigFromSource(source)),
    }),
  deserializeBindingConfig: ({ id, bindingConfigJson }) =>
    Effect.map(
      decodeBindingConfig({
        sourceId: id,
        label: "MCP",
        adapterKey: "mcp",
        version: MCP_BINDING_CONFIG_VERSION,
        payloadSchema: McpBindingConfigSchema,
        value: bindingConfigJson,
      }),
      ({ version, payload }) => ({
        version,
        payload,
      }),
    ),
  bindingStateFromSource: (source) =>
    Effect.map(mcpBindingConfigFromSource(source), (bindingConfig) => ({
      ...emptySourceBindingState,
      transport: bindingConfig.transport,
      queryParams: bindingConfig.queryParams,
      headers: bindingConfig.headers,
    })),
  sourceConfigFromSource: (source) =>
    Effect.runSync(
      Effect.map(mcpBindingConfigFromSource(source), (bindingConfig) => ({
        kind: "mcp",
        endpoint: source.endpoint,
        transport: bindingConfig.transport,
        queryParams: bindingConfig.queryParams,
        headers: bindingConfig.headers,
      })),
    ),
  validateSource: (source) =>
    Effect.gen(function* () {
      const bindingConfig = yield* mcpBindingConfigFromSource(source);

      return {
        ...source,
        bindingVersion: MCP_BINDING_CONFIG_VERSION,
        binding: {
          transport: bindingConfig.transport,
          queryParams: bindingConfig.queryParams,
          headers: bindingConfig.headers,
        },
      };
    }),
  shouldAutoProbe: () => false,
  syncCatalog: ({ source, resolveAuthMaterialForSlot }) =>
    Effect.gen(function* () {
      const bindingConfig = yield* mcpBindingConfigFromSource(source);
      const auth = yield* resolveAuthMaterialForSlot("import");
      const connector = yield* Effect.try({
        try: () =>
          createSdkMcpConnector({
            endpoint: source.endpoint,
            transport: bindingConfig.transport ?? undefined,
            queryParams: {
              ...(bindingConfig.queryParams ?? {}),
              ...auth.queryParams,
            },
            headers: headersWithAuthCookies({
              headers: bindingConfig.headers ?? {},
              authHeaders: auth.headers,
              authCookies: auth.cookies,
            }),
            authProvider: auth.authProvider,
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

      return catalogSyncResultFromMcpManifest({
        source,
        endpoint: source.endpoint,
        manifest: discovered.manifest,
      });
    }),
  invoke: (input) =>
    Effect.tryPromise({
      try: async () => {
        if (input.executable.adapterKey !== "mcp") {
          throw new Error(
            `Expected MCP executable binding, got ${input.executable.adapterKey}`,
          );
        }
        const providerData = decodeExecutableBindingPayload({
          executableId: input.executable.id,
          label: "MCP",
          version: input.executable.bindingVersion,
          expectedVersion: EXECUTABLE_BINDING_VERSION,
          schema: McpExecutableBindingSchema,
          value: input.executable.binding,
        }) as McpExecutableBinding;

        const bindingConfig = Effect.runSync(
          mcpBindingConfigFromSource(input.source),
        );
        const connector = createSdkMcpConnector({
          endpoint: input.source.endpoint,
          transport: bindingConfig.transport ?? undefined,
          queryParams: {
            ...(bindingConfig.queryParams ?? {}),
            ...input.auth.queryParams,
          },
          headers: headersWithAuthCookies({
            headers: bindingConfig.headers ?? {},
            authHeaders: input.auth.headers,
            authCookies: input.auth.cookies,
          }),
          authProvider: input.auth.authProvider,
        });
        const tools = createMcpToolsFromManifest({
          manifest: {
            version: 2,
            tools: [
              {
                toolId: providerData.toolName,
                toolName: providerData.toolName,
                displayTitle:
                  input.capability.surface.title ??
                  input.executable.display?.title ??
                  providerData.toolName,
                title:
                  input.capability.surface.title ??
                  input.executable.display?.title ??
                  null,
                description:
                  input.capability.surface.summary ??
                  input.capability.surface.description ??
                  input.executable.display?.summary ??
                  `MCP tool: ${providerData.toolName}`,
                annotations: null,
                execution: null,
                icons: null,
                meta: null,
                rawTool: null,
                inputSchema: input.descriptor.inputSchema,
                outputSchema: input.descriptor.outputSchema,
              },
            ],
          },
          connect: connector,
          sourceKey: input.source.id,
        });
        const entry = tools[providerData.toolName] as ToolInput | undefined;
        const definition =
          entry &&
          typeof entry === "object" &&
          entry !== null &&
          "tool" in entry
            ? entry.tool
            : entry;

        if (!definition) {
          throw new Error(
            `Missing MCP tool definition for ${providerData.toolName}`,
          );
        }

        const inputShape = input.executable.projection.callShapeId
          ? input.catalog.symbols[input.executable.projection.callShapeId]
          : undefined;
        const payload =
          inputShape?.kind === "shape" && inputShape.node.type !== "object"
            ? asRecord(input.args).input
            : input.args;
        const executionContext: ToolExecutionContext | undefined =
          input.onElicitation
            ? {
                path: asToolPath(input.descriptor.path),
                sourceKey: input.source.id,
                metadata: {
                  sourceKey: input.source.id,
                  interaction: input.descriptor.interaction,
                  inputSchema: input.descriptor.inputSchema,
                  outputSchema: input.descriptor.outputSchema,
                  providerKind: input.descriptor.providerKind,
                  providerData: input.descriptor.providerData,
                },
                invocation: input.context,
                onElicitation: input.onElicitation,
              }
            : undefined;
        const result = await definition.execute(
          asRecord(payload),
          executionContext,
        );
        const resultRecord = asRecord(result);
        const isError = resultRecord.isError === true;

        return {
          data: isError ? null : (result ?? null),
          error: isError ? result : null,
          headers: {},
          status: null,
        };
      },
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    }),
};
