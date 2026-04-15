// ---------------------------------------------------------------------------
// Stub keychain plugin — no schema, no storage, no sources, no tools.
// Contributes only a SecretProvider and an extension. The plugin spec
// no longer has an `invokeTool` stub; keychain has no tools, so it
// simply doesn't declare one.
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { definePlugin } from "../plugin";
import type { SecretProvider } from "../types";

export interface KeychainExtension {
  /** Diagnostic — how many secrets this keychain holds. */
  readonly count: () => Effect.Effect<number>;
}

export const keychainPlugin = definePlugin(() => {
  const store = new Map<string, string>();

  const provider: SecretProvider = {
    kind: "keychain",
    get: (id) => Effect.sync(() => store.get(id) ?? null),
    set: (id, value) =>
      Effect.sync(() => {
        store.set(id, value);
      }),
    remove: (id) =>
      Effect.sync(() => {
        store.delete(id);
      }),
    list: () => Effect.sync(() => Array.from(store.keys())),
  };

  return {
    id: "keychain" as const,
    storage: () => ({} as const),
    secretProviders: [provider],
    extension: () =>
      ({
        count: () => Effect.sync(() => store.size),
      }) satisfies KeychainExtension,
  };
});
