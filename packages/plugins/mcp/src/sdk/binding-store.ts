// ---------------------------------------------------------------------------
// McpBindingStore — plugin's own storage for tool bindings + source data
// ---------------------------------------------------------------------------

import { Effect, Schema } from "effect";
import {
  makeInMemoryScopedKv,
  scopeKv,
  type Kv,
  type ToolId,
  type ScopedKv,
} from "@executor/sdk";

import { McpToolBinding } from "./types";
import type { McpStoredSourceData } from "./types";

// ---------------------------------------------------------------------------
// Source metadata
// ---------------------------------------------------------------------------

export interface McpSourceMeta {
  readonly namespace: string;
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Stored binding schema
// ---------------------------------------------------------------------------

const StoredBindingEntry = Schema.Struct({
  namespace: Schema.String,
  binding: McpToolBinding,
  sourceData: Schema.Unknown,
});

const encodeBindingEntry = Schema.encodeSync(
  Schema.parseJson(StoredBindingEntry),
);
const decodeBindingEntry = Schema.decodeUnknownSync(
  Schema.parseJson(StoredBindingEntry),
);

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface McpBindingStore {
  readonly get: (
    toolId: ToolId,
  ) => Effect.Effect<{
    binding: McpToolBinding;
    sourceData: McpStoredSourceData;
  } | null>;

  readonly put: (
    toolId: ToolId,
    namespace: string,
    binding: McpToolBinding,
    sourceData: McpStoredSourceData,
  ) => Effect.Effect<void>;

  readonly remove: (toolId: ToolId) => Effect.Effect<void>;

  readonly listByNamespace: (
    namespace: string,
  ) => Effect.Effect<readonly ToolId[]>;

  readonly removeByNamespace: (
    namespace: string,
  ) => Effect.Effect<readonly ToolId[]>;

  readonly putSourceMeta: (meta: McpSourceMeta) => Effect.Effect<void>;
  readonly removeSourceMeta: (namespace: string) => Effect.Effect<void>;
  readonly listSourceMeta: () => Effect.Effect<readonly McpSourceMeta[]>;

  readonly putSourceData: (
    namespace: string,
    data: McpStoredSourceData,
  ) => Effect.Effect<void>;
  readonly getSourceData: (
    namespace: string,
  ) => Effect.Effect<McpStoredSourceData | null>;
  readonly removeSourceData: (namespace: string) => Effect.Effect<void>;
}

// ---------------------------------------------------------------------------
// Implementation — three separate KV namespaces, no prefix hacks
// ---------------------------------------------------------------------------

const makeStore = (
  bindings: ScopedKv,
  meta: ScopedKv,
  config: ScopedKv,
): McpBindingStore => ({
  // ---- Bindings ----

  get: (toolId) =>
    Effect.gen(function* () {
      const raw = yield* bindings.get(toolId);
      if (!raw) return null;
      const entry = decodeBindingEntry(raw);
      return {
        binding: entry.binding as McpToolBinding,
        sourceData: entry.sourceData as McpStoredSourceData,
      };
    }),

  put: (toolId, namespace, binding, sourceData) =>
    bindings.set(
      toolId,
      encodeBindingEntry({ namespace, binding, sourceData }),
    ),

  remove: (toolId) => bindings.delete(toolId).pipe(Effect.asVoid),

  listByNamespace: (namespace) =>
    Effect.gen(function* () {
      const entries = yield* bindings.list();
      const ids: ToolId[] = [];
      for (const e of entries) {
        const entry = decodeBindingEntry(e.value);
        if (entry.namespace === namespace) ids.push(e.key as ToolId);
      }
      return ids;
    }),

  removeByNamespace: (namespace) =>
    Effect.gen(function* () {
      const entries = yield* bindings.list();
      const ids: ToolId[] = [];
      for (const e of entries) {
        const entry = decodeBindingEntry(e.value);
        if (entry.namespace === namespace) {
          ids.push(e.key as ToolId);
          yield* bindings.delete(e.key);
        }
      }
      return ids;
    }),

  // ---- Source metadata ----

  putSourceMeta: (m) =>
    meta.set(m.namespace, JSON.stringify(m)),

  removeSourceMeta: (namespace) =>
    meta.delete(namespace).pipe(Effect.asVoid),

  listSourceMeta: () =>
    Effect.gen(function* () {
      const entries = yield* meta.list();
      return entries.map((e) => JSON.parse(e.value) as McpSourceMeta);
    }),

  // ---- Source config ----

  putSourceData: (namespace, data) =>
    config.set(namespace, JSON.stringify(data)),

  getSourceData: (namespace) =>
    Effect.gen(function* () {
      const raw = yield* config.get(namespace);
      return raw ? (JSON.parse(raw) as McpStoredSourceData) : null;
    }),

  removeSourceData: (namespace) =>
    config.delete(namespace).pipe(Effect.asVoid),
});

// ---------------------------------------------------------------------------
// Factory from global Kv — creates three scoped sub-namespaces
// ---------------------------------------------------------------------------

export const makeKvBindingStore = (
  kv: Kv,
  namespace: string,
): McpBindingStore =>
  makeStore(
    scopeKv(kv, `${namespace}.bindings`),
    scopeKv(kv, `${namespace}.sources`),
    scopeKv(kv, `${namespace}.config`),
  );

// ---------------------------------------------------------------------------
// In-memory convenience
// ---------------------------------------------------------------------------

export const makeInMemoryBindingStore = (): McpBindingStore =>
  makeStore(
    makeInMemoryScopedKv(),
    makeInMemoryScopedKv(),
    makeInMemoryScopedKv(),
  );
