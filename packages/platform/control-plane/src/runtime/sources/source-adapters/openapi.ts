import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import {
  applyCookiePlacementsToHeaders,
  applyHttpQueryPlacementsToUrl,
} from "@executor/codemode-core";
import {
  buildOpenApiToolPresentation,
  compileOpenApiToolDefinitions,
  type OpenApiRefHintTable,
  type OpenApiToolProviderData,
  extractOpenApiManifest,
} from "@executor/codemode-openapi";
import type { Source } from "#schema";
import { StringMapSchema } from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  createCatalogImportMetadata,
  createOpenApiCatalogFragment,
  type OpenApiCatalogOperationInput,
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

const OpenApiConnectPayloadSchema = Schema.extend(
  SourceConnectCommonFieldsSchema,
  Schema.extend(
    ConnectHttpImportAuthSchema,
    Schema.Struct({
      kind: Schema.Literal("openapi"),
      specUrl: Schema.Trim.pipe(Schema.nonEmptyString()),
      auth: Schema.optional(ConnectHttpAuthSchema),
    }),
  ),
);

const OpenApiExecutorAddInputSchema = Schema.extend(
  ConnectHttpImportAuthSchema,
  Schema.Struct({
    kind: Schema.Literal("openapi"),
    endpoint: Schema.String,
    specUrl: Schema.String,
    name: OptionalNullableStringSchema,
    namespace: OptionalNullableStringSchema,
    auth: Schema.optional(ConnectHttpAuthSchema),
  }),
);

const OpenApiBindingConfigSchema = Schema.Struct({
  specUrl: Schema.Trim.pipe(Schema.nonEmptyString()),
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
});

const OpenApiSourceBindingPayloadSchema = Schema.Struct({
  specUrl: Schema.optional(Schema.String),
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
});

type OpenApiBindingConfig = {
  specUrl: string;
  defaultHeaders: typeof StringMapSchema.Type | null;
};

const OPENAPI_BINDING_CONFIG_VERSION = 1;

const bindingHasAnyField = (
  value: unknown,
  fields: readonly string[],
): boolean =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && fields.some((field) => Object.prototype.hasOwnProperty.call(value, field));

const openApiBindingConfigFromSource = (
  source: Pick<Source, "id" | "bindingVersion" | "binding">,
): Effect.Effect<OpenApiBindingConfig, Error, never> =>
  Effect.gen(function* () {
    if (bindingHasAnyField(source.binding, ["transport", "queryParams", "headers"])) {
      return yield* Effect.fail(
        new Error("OpenAPI sources cannot define MCP transport settings"),
      );
    }

    const bindingConfig = yield* decodeSourceBindingPayload({
      sourceId: source.id,
      label: "OpenAPI",
      version: source.bindingVersion,
      expectedVersion: OPENAPI_BINDING_CONFIG_VERSION,
      schema: OpenApiSourceBindingPayloadSchema,
      value: source.binding,
      allowedKeys: ["specUrl", "defaultHeaders"],
    });

    const specUrl = typeof bindingConfig.specUrl === "string"
      ? bindingConfig.specUrl.trim()
      : "";
    if (specUrl.length === 0) {
      return yield* Effect.fail(new Error("OpenAPI sources require specUrl"));
    }

    return {
      specUrl,
      defaultHeaders: bindingConfig.defaultHeaders ?? null,
    } satisfies OpenApiBindingConfig;
  });

const fetchOpenApiDocumentWithHeaders = (input: {
  url: string;
  headers?: Readonly<Record<string, string>>;
  queryParams?: Readonly<Record<string, string>>;
  cookies?: Readonly<Record<string, string>>;
}): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(
      applyHttpQueryPlacementsToUrl({
        url: input.url,
        queryParams: input.queryParams,
      }).toString(),
    ).pipe(
      HttpClientRequest.setHeaders(
        applyCookiePlacementsToHeaders({
          headers: input.headers ?? {},
          cookies: input.cookies,
        }),
      ),
    );
    const response = yield* client.execute(request).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(
        new SourceCredentialRequiredError(
          "import",
          `OpenAPI spec fetch requires credentials (status ${response.status})`,
        ),
      );
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new Error(`OpenAPI spec fetch failed with status ${response.status}`),
      );
    }

    return yield* response.text.pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));

const openApiCatalogOperationFromDefinition = (
  input: {
    definition: ReturnType<typeof compileOpenApiToolDefinitions>[number];
    refHintTable?: Readonly<OpenApiRefHintTable>;
  },
): OpenApiCatalogOperationInput => {
  const presentation = buildOpenApiToolPresentation({
    definition: input.definition,
    refHintTable: input.refHintTable,
  });
  const method = input.definition.method.toUpperCase();

  return {
    toolId: input.definition.toolId,
    title: input.definition.name,
    description: input.definition.description,
    effect:
      method === "GET" || method === "HEAD"
        ? "read"
        : method === "DELETE"
          ? "delete"
          : "write",
    inputSchema: presentation.inputSchema,
    outputSchema: presentation.outputSchema,
    providerData: presentation.providerData as OpenApiToolProviderData,
  };
};

export const openApiSourceAdapter: SourceAdapter = {
  key: "openapi",
  displayName: "OpenAPI",
  family: "http_api",
  bindingConfigVersion: OPENAPI_BINDING_CONFIG_VERSION,
  providerKey: "generic_http",
  defaultImportAuthPolicy: "reuse_runtime",
  connectPayloadSchema: OpenApiConnectPayloadSchema,
  executorAddInputSchema: OpenApiExecutorAddInputSchema,
  executorAddHelpText: [
    "endpoint is the base API URL. specUrl is the OpenAPI document URL.",
  ],
  executorAddInputSignatureWidth: 420,
  serializeBindingConfig: (source) =>
    encodeBindingConfig({
      adapterKey: "openapi",
      version: OPENAPI_BINDING_CONFIG_VERSION,
      payloadSchema: OpenApiBindingConfigSchema,
      payload: Effect.runSync(openApiBindingConfigFromSource(source)),
    }),
  deserializeBindingConfig: ({ id, bindingConfigJson }) =>
    Effect.map(
      decodeBindingConfig({
        sourceId: id,
        label: "OpenAPI",
        adapterKey: "openapi",
        version: OPENAPI_BINDING_CONFIG_VERSION,
        payloadSchema: OpenApiBindingConfigSchema,
        value: bindingConfigJson,
      }),
      ({ version, payload }) => ({
        version,
        payload: {
          specUrl: payload.specUrl,
          defaultHeaders: payload.defaultHeaders ?? null,
        },
      }),
    ),
  bindingStateFromSource: (source) =>
    Effect.map(openApiBindingConfigFromSource(source), (bindingConfig) => ({
      ...emptySourceBindingState,
      specUrl: bindingConfig.specUrl,
      defaultHeaders: bindingConfig.defaultHeaders,
    })),
  sourceConfigFromSource: (source) =>
    Effect.runSync(
      Effect.map(openApiBindingConfigFromSource(source), (bindingConfig) => ({
        kind: "openapi",
        endpoint: source.endpoint,
        specUrl: bindingConfig.specUrl,
        defaultHeaders: bindingConfig.defaultHeaders,
      })),
    ),
  validateSource: (source) =>
    Effect.gen(function* () {
      const bindingConfig = yield* openApiBindingConfigFromSource(source);
      return {
        ...source,
        bindingVersion: OPENAPI_BINDING_CONFIG_VERSION,
        binding: {
          specUrl: bindingConfig.specUrl,
          defaultHeaders: bindingConfig.defaultHeaders,
        },
      };
    }),
  shouldAutoProbe: (source) =>
    source.enabled && (source.status === "draft" || source.status === "probing"),
  syncCatalog: ({ source, resolveAuthMaterialForSlot }) =>
    Effect.gen(function* () {
      const bindingConfig = yield* openApiBindingConfigFromSource(source);

      const auth = yield* resolveAuthMaterialForSlot("import");
      const openApiDocument = yield* fetchOpenApiDocumentWithHeaders({
        url: bindingConfig.specUrl,
        headers: {
          ...(bindingConfig.defaultHeaders ?? {}),
          ...auth.headers,
        },
        queryParams: auth.queryParams,
        cookies: auth.cookies,
      }).pipe(
        Effect.mapError(
          (cause) =>
            isSourceCredentialRequiredError(cause)
              ? cause
              : new Error(
                `Failed fetching OpenAPI spec for ${source.id}: ${cause.message}`,
              ),
        ),
      );

      const manifest = yield* extractOpenApiManifest(
        source.name,
        openApiDocument,
      ).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

      const definitions = compileOpenApiToolDefinitions(manifest);
      const now = Date.now();

      return createSourceCatalogSyncResult({
        fragment: createOpenApiCatalogFragment({
          source,
          documents: [{
            documentKind: "openapi",
            documentKey: bindingConfig.specUrl,
            contentText: openApiDocument,
            fetchedAt: now,
          }],
          operations: definitions.map((definition) =>
            openApiCatalogOperationFromDefinition({
              definition,
              refHintTable: manifest.refHintTable,
            })),
        }),
        importMetadata: createCatalogImportMetadata({
          source,
          adapterKey: "openapi",
        }),
        sourceHash: manifest.sourceHash,
      });
    }),
};
