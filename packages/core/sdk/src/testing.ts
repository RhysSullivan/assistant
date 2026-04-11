import { Effect } from "effect";
import { makeMemoryStorage } from "@executor/storage-memory";

import { ScopeId } from "./ids";
import type { Scope } from "./scope";
import type { ExecutorConfig } from "./executor";
import type { ExecutorPlugin } from "./plugin";

// ---------------------------------------------------------------------------
// makeTestConfig — one-liner to build a test ExecutorConfig backed by
// an in-memory storage adapter.
// ---------------------------------------------------------------------------

export const makeTestConfig = <
  const TPlugins extends readonly ExecutorPlugin<string, object>[] = [],
>(options?: {
  readonly cwd?: string;
  readonly plugins?: TPlugins;
}): ExecutorConfig<TPlugins> => {
  const cwd = options?.cwd ?? "/test";
  const scope: Scope = {
    id: ScopeId.make("test-scope"),
    name: cwd,
    createdAt: new Date(),
  };

  const storage = Effect.runSync(makeMemoryStorage());

  return {
    scope,
    storage,
    plugins: options?.plugins,
    encryptionKey: "test-encryption-key",
  };
};
