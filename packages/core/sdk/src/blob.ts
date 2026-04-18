// ---------------------------------------------------------------------------
// BlobStore — the seam for large, opaque, write-once data. Separate from
// the relational adapter on purpose: blobs want different lifecycle,
// durability, and placement (think S3/R2 in cloud, flat files locally)
// than the metadata that indexes them.
//
// Plugins see a `ScopedBlobStore` that's already namespaced to the plugin
// id, so key collisions across plugins are structurally impossible.
//
// Error channel is `StorageError` — blobs only do read/write/delete, so
// they never produce `UniqueViolationError`. The HTTP edge translates
// `StorageError` to the opaque public `InternalError({ traceId })`.
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { StorageError } from "@executor/storage-core";

export interface BlobStore {
  readonly get: (
    namespace: string,
    key: string,
  ) => Effect.Effect<string | null, StorageError>;
  readonly put: (
    namespace: string,
    key: string,
    value: string,
  ) => Effect.Effect<void, StorageError>;
  readonly delete: (
    namespace: string,
    key: string,
  ) => Effect.Effect<void, StorageError>;
  readonly has: (
    namespace: string,
    key: string,
  ) => Effect.Effect<boolean, StorageError>;
}

export interface ScopedBlobStore {
  readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
  readonly put: (
    key: string,
    value: string,
  ) => Effect.Effect<void, StorageError>;
  readonly delete: (key: string) => Effect.Effect<void, StorageError>;
  readonly has: (key: string) => Effect.Effect<boolean, StorageError>;
}

export const scopeBlobStore = (
  store: BlobStore,
  namespace: string,
): ScopedBlobStore => ({
  get: (key) => store.get(namespace, key),
  put: (key, value) => store.put(namespace, key, value),
  delete: (key) => store.delete(namespace, key),
  has: (key) => store.has(namespace, key),
});

/**
 * Minimal in-memory BlobStore — good for tests and trivial hosts. Real
 * backends (filesystem, S3/R2, SQLite-table-backed) implement the same
 * interface.
 *
 * Every method is `Effect<_, never>` — a pure in-memory Map can't fail.
 * `never` is assignable to `StorageError`, so the result still fits the
 * `BlobStore` interface.
 */
export const makeInMemoryBlobStore = (): BlobStore => {
  const store = new Map<string, string>();
  const k = (ns: string, key: string) => `${ns}::${key}`;
  return {
    get: (ns, key) => Effect.sync(() => store.get(k(ns, key)) ?? null),
    put: (ns, key, value) =>
      Effect.sync(() => {
        store.set(k(ns, key), value);
      }),
    delete: (ns, key) =>
      Effect.sync(() => {
        store.delete(k(ns, key));
      }),
    has: (ns, key) => Effect.sync(() => store.has(k(ns, key))),
  };
};
