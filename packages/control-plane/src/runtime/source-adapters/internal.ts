import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { SourceAdapter } from "./types";
import {
  createStandardToolDescriptor,
  decodeBindingConfig,
  emptySourceBindingState,
  encodeBindingConfig,
} from "./shared";

const InternalBindingConfigSchema = Schema.Struct({
  adapterKey: Schema.String,
});

export const internalSourceAdapter: SourceAdapter = {
  key: "internal",
  displayName: "Internal",
  family: "internal",
  providerKey: "generic_internal",
  defaultImportAuthPolicy: "none",
  primaryDocumentKind: null,
  primarySchemaBundleKind: null,
  connectPayloadSchema: null,
  executorAddInputSchema: null,
  executorAddHelpText: null,
  executorAddInputSignatureWidth: null,
  serializeBindingConfig: (source) =>
    encodeBindingConfig(InternalBindingConfigSchema, {
      adapterKey: source.kind,
    }),
  deserializeBindingConfig: ({ id, bindingConfigJson }) =>
    Effect.map(
      decodeBindingConfig({
        sourceId: id,
        label: "internal",
        schema: InternalBindingConfigSchema,
        value: bindingConfigJson,
      }),
      () => emptySourceBindingState,
    ),
  sourceConfigFromSource: (source) => ({
    kind: "internal",
    endpoint: source.endpoint,
  }),
  validateSource: (source) =>
    Effect.gen(function* () {
      if (source.transport !== null || source.queryParams !== null || source.headers !== null) {
        return yield* Effect.fail(
          new Error(`${source.kind} sources cannot define MCP transport settings`),
        );
      }

      if (source.specUrl !== null || source.defaultHeaders !== null) {
        return yield* Effect.fail(
          new Error(`${source.kind} sources cannot define HTTP source settings`),
        );
      }

      return source;
    }),
  shouldAutoProbe: () => false,
  parseManifest: () => Effect.succeed(null),
  describePersistedOperation: ({ operation, path }) =>
    Effect.succeed({
      method: null,
      pathTemplate: null,
      rawToolId: null,
      operationId: null,
      group: null,
      leaf: null,
      tags: [],
      searchText: [path, operation.toolId, operation.title ?? "", operation.description ?? "", operation.searchText]
        .filter((part) => part.length > 0)
        .join(" ")
        .toLowerCase(),
      interaction: "auto",
      approvalLabel: null,
    } as const),
  createToolDescriptor: ({ source, operation, path, includeSchemas, schemaBundleId }) =>
    createStandardToolDescriptor({
      source,
      operation,
      path,
      includeSchemas,
      interaction: "auto",
      schemaBundleId,
    }),
  materializeSource: () => Effect.succeed({
    manifestJson: null,
    manifestHash: null,
    sourceHash: null,
    documents: [],
    schemaBundles: [],
    operations: [],
  }),
  invokePersistedTool: ({ path }) =>
    Effect.fail(new Error(`Unsupported stored tool provider for ${path}`)),
};
