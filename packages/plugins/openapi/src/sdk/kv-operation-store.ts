// ---------------------------------------------------------------------------
// KV-backed OpenApiOperationStore
//
// Uses two separate KV namespaces — one for bindings, one for source meta.
// ---------------------------------------------------------------------------

import { Effect, Schema } from "effect";
import { scopeKv, makeInMemoryScopedKv, type Kv, type ToolId, type ScopedKv } from "@executor/sdk";

import type { OpenApiOperationStore, SourceMeta } from "./operation-store";
import { OperationBinding, InvocationConfig } from "./types";

// ---------------------------------------------------------------------------
// Stored entry schema
// ---------------------------------------------------------------------------

class StoredEntry extends Schema.Class<StoredEntry>("StoredEntry")({
  namespace: Schema.String,
  binding: OperationBinding,
  config: InvocationConfig,
}) {}

const encodeEntry = Schema.encodeSync(Schema.parseJson(StoredEntry));
const decodeEntry = Schema.decodeUnknownSync(Schema.parseJson(StoredEntry));

// ---------------------------------------------------------------------------
// Implementation — separate KV for bindings vs source meta
// ---------------------------------------------------------------------------

const makeStore = (
  bindings: ScopedKv,
  meta: ScopedKv,
): OpenApiOperationStore => ({
  get: (toolId) =>
    Effect.gen(function* () {
      const raw = yield* bindings.get(toolId);
      if (!raw) return null;
      const entry = decodeEntry(raw);
      return { binding: entry.binding, config: entry.config };
    }),

  put: (toolId, namespace, binding, config) =>
    bindings.set(
      toolId,
      encodeEntry(new StoredEntry({ namespace, binding, config })),
    ),

  remove: (toolId) => bindings.delete(toolId).pipe(Effect.asVoid),

  listByNamespace: (namespace) =>
    Effect.gen(function* () {
      const entries = yield* bindings.list();
      const ids: ToolId[] = [];
      for (const e of entries) {
        const entry = decodeEntry(e.value);
        if (entry.namespace === namespace) ids.push(e.key as ToolId);
      }
      return ids;
    }),

  removeByNamespace: (namespace) =>
    Effect.gen(function* () {
      const entries = yield* bindings.list();
      const ids: ToolId[] = [];
      for (const e of entries) {
        const entry = decodeEntry(e.value);
        if (entry.namespace === namespace) {
          ids.push(e.key as ToolId);
          yield* bindings.delete(e.key);
        }
      }
      return ids;
    }),

  putSourceMeta: (m) => meta.set(m.namespace, JSON.stringify(m)),

  removeSourceMeta: (namespace) =>
    meta.delete(namespace).pipe(Effect.asVoid),

  listSourceMeta: () =>
    Effect.gen(function* () {
      const entries = yield* meta.list();
      return entries.map((e) => JSON.parse(e.value) as SourceMeta);
    }),
});

// ---------------------------------------------------------------------------
// Factory from global Kv
// ---------------------------------------------------------------------------

export const makeKvOperationStore = (
  kv: Kv,
  namespace: string,
): OpenApiOperationStore =>
  makeStore(
    scopeKv(kv, `${namespace}.bindings`),
    scopeKv(kv, `${namespace}.sources`),
  );

export const makeInMemoryOperationStore = (): OpenApiOperationStore =>
  makeStore(makeInMemoryScopedKv(), makeInMemoryScopedKv());
