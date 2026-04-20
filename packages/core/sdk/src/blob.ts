// ---------------------------------------------------------------------------
// BlobStore — the seam for large, opaque, write-once data. Separate from
// the relational adapter on purpose: blobs want different lifecycle,
// durability, and placement (think S3/R2 in cloud, flat files locally)
// than the metadata that indexes them.
//
// Plugins see a `PluginBlobStore` that's already namespaced to the
// plugin id and bound to the executor's scope stack. Reads fall through
// the stack in order (innermost first, first hit wins); writes and
// deletes require an explicit scope id naming where the operation
// should land. That mirrors the secrets API — shadowing by key on
// read, explicit target on write.
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

export interface PluginBlobStore {
  /** Walk the scope stack (innermost first) and return the first
   *  non-null value for `key`. */
  readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
  /** Write `value` under `key` at the named scope. Scope must be one
   *  of the executor's configured scopes. */
  readonly put: (
    key: string,
    value: string,
    options: { readonly scope: string },
  ) => Effect.Effect<void, StorageError>;
  /** Delete `key` at the named scope. */
  readonly delete: (
    key: string,
    options: { readonly scope: string },
  ) => Effect.Effect<void, StorageError>;
  /** Walk the scope stack and return true if any scope has a value for `key`. */
  readonly has: (key: string) => Effect.Effect<boolean, StorageError>;
}

const assertScope = (
  scope: string,
  scopes: readonly string[],
): Effect.Effect<void, StorageError> =>
  scopes.includes(scope)
    ? Effect.void
    : Effect.fail(
        new StorageError({
          message:
            `Blob write targets scope "${scope}" which is not in the ` +
            `executor's scope stack [${scopes.join(", ")}].`,
          cause: undefined,
        }),
      );

const nsFor = (scope: string, pluginId: string) => `${scope}/${pluginId}`;

/**
 * Bind a `BlobStore` to a specific scope stack and plugin id. Reads
 * fall through the stack; writes require an explicit scope. Used by
 * the executor to build the `blobs` field handed to each plugin's
 * `storage` factory.
 */
export const pluginBlobStore = (
  store: BlobStore,
  scopes: readonly string[],
  pluginId: string,
): PluginBlobStore => ({
  get: (key) =>
    Effect.gen(function* () {
      for (const scope of scopes) {
        const value = yield* store.get(nsFor(scope, pluginId), key);
        if (value !== null) return value;
      }
      return null;
    }),
  put: (key, value, options) =>
    Effect.flatMap(assertScope(options.scope, scopes), () =>
      store.put(nsFor(options.scope, pluginId), key, value),
    ),
  delete: (key, options) =>
    Effect.flatMap(assertScope(options.scope, scopes), () =>
      store.delete(nsFor(options.scope, pluginId), key),
    ),
  has: (key) =>
    Effect.gen(function* () {
      for (const scope of scopes) {
        const found = yield* store.has(nsFor(scope, pluginId), key);
        if (found) return true;
      }
      return false;
    }),
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
