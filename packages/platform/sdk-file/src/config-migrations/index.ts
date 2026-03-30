import { FileSystem } from "@effect/platform";
import * as Effect from "effect/Effect";
import type {
  ExecutorScopeConfigDecodeError,
  LocalFileSystemError,
} from "../errors";
import {
  migrateLegacyExecutorScopeConfigs,
  type StartupConfigMigrationContext,
} from "./legacy-local-config";

type StartupConfigMigration = (
  context: StartupConfigMigrationContext,
) => Effect.Effect<
  ReadonlyArray<string>,
  LocalFileSystemError | ExecutorScopeConfigDecodeError,
  FileSystem.FileSystem
>;

// Keep legacy upgrade steps out of steady-state config loading so they can be
// extended or deleted without touching the main application path.
const startupConfigMigrations: readonly StartupConfigMigration[] = [
  migrateLegacyExecutorScopeConfigs,
];

export const runStartupConfigMigrations = (
  context: StartupConfigMigrationContext,
): Effect.Effect<
  ReadonlyArray<string>,
  LocalFileSystemError | ExecutorScopeConfigDecodeError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const migratedPaths = new Set<string>();

    for (const migrate of startupConfigMigrations) {
      for (const path of yield* migrate(context)) {
        migratedPaths.add(path);
      }
    }

    return [...migratedPaths];
  });

export {
  migrateLegacyExecutorScopeConfigs,
  type StartupConfigMigrationContext,
} from "./legacy-local-config";
