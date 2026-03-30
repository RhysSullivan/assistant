import { FileSystem } from "@effect/platform";
import * as Effect from "effect/Effect";

import type { ResolvedLocalWorkspaceContext } from "../config";
import type { LocalFileSystemError } from "../errors";
import { migrateLegacyLocalExecutorState } from "./legacy-local-executor-state";

type StartupExecutorStateMigration = (
  context: ResolvedLocalWorkspaceContext,
) => Effect.Effect<ReadonlyArray<string>, LocalFileSystemError, FileSystem.FileSystem>;

// Keep legacy executor-state upgrades isolated from the live store path.
const startupExecutorStateMigrations: readonly StartupExecutorStateMigration[] = [
  migrateLegacyLocalExecutorState,
];

export const runStartupExecutorStateMigrations = (
  context: ResolvedLocalWorkspaceContext,
): Effect.Effect<ReadonlyArray<string>, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const migratedPaths = new Set<string>();

    for (const migrate of startupExecutorStateMigrations) {
      for (const path of yield* migrate(context)) {
        migratedPaths.add(path);
      }
    }

    return [...migratedPaths];
  });

export { migrateLegacyLocalExecutorState } from "./legacy-local-executor-state";
