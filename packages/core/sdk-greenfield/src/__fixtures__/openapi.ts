// ---------------------------------------------------------------------------
// Stub openapi plugin — static control tools with inline handlers
// (using `self` to call extension methods directly), and `invokeTool`
// for dynamic openapi operations.
//
// No dispatcher. Static tools are declared as first-class objects with
// inline handlers. The add-source control tool is a three-line wrapper
// over self.addSpec — zero logic duplication.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { DBAdapter, DBSchema } from "@executor/storage-core";

import type { ScopedBlobStore } from "../blob";
import { definePlugin } from "../plugin";

// ---------------------------------------------------------------------------
// Plugin schema — only openapi-specific enrichment. Core source/tool
// data lives in the core tables.
// ---------------------------------------------------------------------------

export const openapiSchema: DBSchema = {
  openapi_operation: {
    modelName: "openapi_operation",
    fields: {
      id: { type: "string", required: true },
      source_id: { type: "string", required: true, index: true },
      tool_name: { type: "string", required: true },
      method: { type: "string", required: true },
      path: { type: "string", required: true },
    },
  },
};

const specKey = (sourceId: string) => `source/${sourceId}/spec`;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface OpenApiOperation {
  readonly toolName: string;
  readonly method: string;
  readonly path: string;
}

export interface UpsertSpecInput {
  readonly namespace: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly spec: string;
  readonly operations: readonly OpenApiOperation[];
}

export interface StoredSpec {
  readonly id: string;
  readonly spec: string;
  readonly operations: readonly OpenApiOperation[];
}

// ---------------------------------------------------------------------------
// OpenApiSpecStore — Pattern-C override point. Operates only on
// plugin-specific data; the core source/tool tables are NOT touched
// through this interface.
// ---------------------------------------------------------------------------

export interface OpenApiSpecStore {
  readonly upsertSpec: (input: UpsertSpecInput) => Effect.Effect<void, Error>;
  readonly getSpec: (
    sourceId: string,
  ) => Effect.Effect<StoredSpec | null, Error>;
  readonly getOperation: (
    sourceId: string,
    toolName: string,
  ) => Effect.Effect<OpenApiOperation | null, Error>;
  readonly removeSpec: (sourceId: string) => Effect.Effect<void, Error>;
}

interface OpenApiOperationRow extends Record<string, unknown> {
  id: string;
  source_id: string;
  tool_name: string;
  method: string;
  path: string;
}

export const makeDefaultOpenApiSpecStore = (
  adapter: DBAdapter,
  blobs: ScopedBlobStore,
): OpenApiSpecStore => ({
  upsertSpec: (input) =>
    Effect.gen(function* () {
      for (const op of input.operations) {
        yield* adapter.create<OpenApiOperationRow>({
          model: "openapi_operation",
          data: {
            id: `${input.namespace}.${op.toolName}`,
            source_id: input.namespace,
            tool_name: op.toolName,
            method: op.method,
            path: op.path,
          },
          forceAllowId: true,
        });
      }
      yield* blobs.put(specKey(input.namespace), input.spec);
    }),

  getSpec: (sourceId) =>
    Effect.gen(function* () {
      const spec = yield* blobs.get(specKey(sourceId));
      if (spec === null) return null;
      const rows = yield* adapter.findMany<OpenApiOperationRow>({
        model: "openapi_operation",
        where: [{ field: "source_id", value: sourceId }],
      });
      return {
        id: sourceId,
        spec,
        operations: rows.map(
          (r): OpenApiOperation => ({
            toolName: r.tool_name,
            method: r.method,
            path: r.path,
          }),
        ),
      };
    }),

  getOperation: (sourceId, toolName) =>
    Effect.gen(function* () {
      const row = yield* adapter.findOne<OpenApiOperationRow>({
        model: "openapi_operation",
        where: [
          { field: "source_id", value: sourceId },
          { field: "tool_name", value: toolName },
        ],
      });
      if (!row) return null;
      return {
        toolName: row.tool_name,
        method: row.method,
        path: row.path,
      };
    }),

  removeSpec: (sourceId) =>
    Effect.gen(function* () {
      yield* adapter.deleteMany({
        model: "openapi_operation",
        where: [{ field: "source_id", value: sourceId }],
      });
      yield* blobs.delete(specKey(sourceId));
    }),
});

// ---------------------------------------------------------------------------
// Extension API
// ---------------------------------------------------------------------------

export interface OpenApiAddSpecInput extends UpsertSpecInput {}

export interface OpenApiExtension {
  readonly addSpec: (
    input: OpenApiAddSpecInput,
  ) => Effect.Effect<
    { readonly sourceId: string; readonly toolCount: number },
    Error
  >;
  readonly getSpec: (
    sourceId: string,
  ) => Effect.Effect<StoredSpec | null, Error>;
  readonly getOperation: (
    sourceId: string,
    toolName: string,
  ) => Effect.Effect<OpenApiOperation | null, Error>;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

// Field order matters for TypeScript inference: `extension` must come
// BEFORE `staticSources` in this object literal so TS can infer
// TExtension from extension's return type before type-checking the
// `self: NoInfer<TExtension>` parameter in staticSources. If
// staticSources is first, TS falls back to the `object` constraint
// and `self` loses its type.
export const openapiPlugin = definePlugin(() => ({
  id: "openapi" as const,
  schema: openapiSchema,
  storage: (deps) => makeDefaultOpenApiSpecStore(deps.adapter, deps.blobs),

  extension: (ctx) =>
    ({
      addSpec: (input) =>
        // Single atomic transaction: plugin enrichment + core metadata.
        // If either side fails, both roll back. Prevents orphan rows
        // in either the plugin-owned openapi_operation table or the
        // core source/tool tables.
        ctx.transaction(
          Effect.gen(function* () {
            yield* ctx.storage.upsertSpec(input);
            yield* ctx.core.sources.register({
              id: input.namespace,
              kind: "openapi",
              name: input.name,
              url: input.baseUrl,
              canRemove: true,
              tools: input.operations.map((op) => ({
                name: op.toolName,
                description: `${op.method.toUpperCase()} ${op.path}`,
              })),
            });
            return {
              sourceId: input.namespace,
              toolCount: input.operations.length,
            };
          }),
        ),
      getSpec: (sourceId) => ctx.storage.getSpec(sourceId),
      getOperation: (sourceId, toolName) =>
        ctx.storage.getOperation(sourceId, toolName),
    }) satisfies OpenApiExtension,

  staticSources: (self) => [
    {
      id: "openapi.control",
      kind: "openapi",
      name: "OpenAPI (control)",
      canRemove: false,
      tools: [
        {
          name: "preview-spec",
          description: "Preview an OpenAPI document before adding it",
          handler: ({ args }) =>
            Effect.succeed({ previewed: true, args }),
        },
        {
          name: "add-source",
          description: "Add an OpenAPI source and register its operations",
          // Thin wrapper over the extension — `self` is the plugin's
          // own built extension, closed over from the staticSources
          // callback above.
          handler: ({ args }) => self.addSpec(args as OpenApiAddSpecInput),
        },
      ],
    },
  ],

  invokeTool: ({ ctx, toolRow, args }) =>
    Effect.gen(function* () {
      const op = yield* ctx.storage.getOperation(
        toolRow.source_id,
        toolRow.name,
      );
      if (!op) {
        return yield* Effect.fail(
          new Error(`openapi: no binding for ${toolRow.id}`),
        );
      }
      return {
        source: toolRow.source_id,
        tool: toolRow.name,
        method: op.method,
        path: op.path,
        args,
      };
    }),

  removeSource: ({ ctx, sourceId }) => ctx.storage.removeSpec(sourceId),
}));
