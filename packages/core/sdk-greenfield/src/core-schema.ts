// ---------------------------------------------------------------------------
// Core data model — Source and Tool as first-class entities owned by the
// SDK itself, not by plugins. These tables are migrated alongside each
// plugin's own schema, and every plugin writes into them via
// `ctx.core.sources.register(...)` as part of its extension operations.
//
// Why the core owns these tables:
//   - Listing is a single adapter query (`SELECT * FROM source`) regardless
//     of how many plugins are installed or how much data each has.
//   - Tool invocation is a single indexed lookup (`findOne tool WHERE id=X`)
//     that tells the executor which plugin owns the tool; the executor
//     then delegates the handler call to `plugin.invokeTool(...)`.
//   - No cold-start rehydration: plugins never scan their own storage at
//     init time to rebuild an in-memory registry. The registry IS the
//     core table, and it's queried on demand.
//
// Plugin-specific enrichment (OpenAPI operation bindings, MCP transport
// config, GraphQL endpoint details beyond url+name) still lives in each
// plugin's own tables. Core metadata is never polluted by plugin-specific
// fields — consumers who need those details call the plugin's extension
// API (`executor.openapi.getOperationBinding(toolId)` etc.).
// ---------------------------------------------------------------------------

import type { DBSchema } from "@executor/storage-core";

export const coreSchema: DBSchema = {
  source: {
    modelName: "source",
    fields: {
      id: { type: "string", required: true },
      plugin_id: { type: "string", required: true, index: true },
      kind: { type: "string", required: true },
      name: { type: "string", required: true },
      url: { type: "string", required: false },
      can_remove: {
        type: "boolean",
        required: true,
        defaultValue: true,
      },
      can_refresh: {
        type: "boolean",
        required: true,
        defaultValue: false,
      },
      created_at: {
        type: "date",
        required: true,
      },
      updated_at: {
        type: "date",
        required: true,
      },
    },
  },
  tool: {
    modelName: "tool",
    fields: {
      id: { type: "string", required: true },
      source_id: { type: "string", required: true, index: true },
      plugin_id: { type: "string", required: true, index: true },
      name: { type: "string", required: true },
      description: { type: "string", required: true },
      // JSON-serialized in SQLite, real JSONB when we port to Postgres.
      input_schema: { type: "json", required: false },
      output_schema: { type: "json", required: false },
      created_at: {
        type: "date",
        required: true,
      },
      updated_at: {
        type: "date",
        required: true,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Row shapes — what the adapter returns from the core tables.
// ---------------------------------------------------------------------------

export interface SourceRow extends Record<string, unknown> {
  id: string;
  plugin_id: string;
  kind: string;
  name: string;
  url: string | null;
  can_remove: boolean;
  can_refresh: boolean;
  created_at: string;
  updated_at: string;
}

export interface ToolRow extends Record<string, unknown> {
  id: string;
  source_id: string;
  plugin_id: string;
  name: string;
  description: string;
  input_schema: unknown | null;
  output_schema: unknown | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// SourceInput — what a plugin passes to `ctx.core.sources.register(...)`.
// Same shape as `staticSources[]` declared on the plugin spec. The
// register call fans out to write both the source row and all the tool
// rows atomically in one transaction.
// ---------------------------------------------------------------------------

export interface SourceInputTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
}

export interface SourceInput {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly url?: string;
  readonly canRemove?: boolean;
  readonly canRefresh?: boolean;
  readonly tools: readonly SourceInputTool[];
}
