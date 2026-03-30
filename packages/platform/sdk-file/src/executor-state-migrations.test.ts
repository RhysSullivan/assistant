import { dirname, join } from "node:path";

import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolveLocalWorkspaceContext } from "./config";
import {
  createLocalExecutorRepositoriesEffect,
  loadLocalExecutorStateSnapshot,
} from "./index";
import { migrateLegacyLocalExecutorState } from "./executor-state-migrations";
import { localExecutorStatePath } from "./executor-state-store";
import { deriveLocalInstallation } from "./installation";

const makeWorkspaceRoot = () =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) =>
      fs.makeTempDirectory({
        prefix: "executor-state-migrations-",
      })
    ),
  );

describe("executor-state-migrations", () => {
  it.effect("rewrites legacy executor state into the current snapshot shape", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* makeWorkspaceRoot();
      const homeStateDirectory = join(workspaceRoot, ".home");
      const context = yield* resolveLocalWorkspaceContext({
        workspaceRoot,
        homeConfigPath: join(workspaceRoot, ".executor-home.jsonc"),
        homeStateDirectory,
      });
      const scopeId = deriveLocalInstallation(context).scopeId;
      const path = localExecutorStatePath(context);
      yield* fs.makeDirectory(dirname(path), { recursive: true });
      yield* fs.writeFileString(
        path,
        `${JSON.stringify({
          version: 1,
          secretStores: [
            {
              id: "sts_builtin_local",
              scopeId,
              name: "Local Store",
              kind: "local",
              status: "connected",
              enabled: true,
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: "sts_builtin_keychain",
              scopeId,
              name: "Desktop Keyring",
              kind: "keychain",
              status: "connected",
              enabled: true,
              createdAt: 2,
              updatedAt: 2,
            },
          ],
          secretMaterials: [
            {
              id: "sec_local",
              name: "Local Secret",
              purpose: "auth_material",
              storeId: "sts_builtin_local",
              handle: "local:abc",
              value: "token-from-local",
              createdAt: 3,
              updatedAt: 4,
            },
            {
              id: "sec_keychain",
              name: "Keychain Secret",
              purpose: "auth_material",
              storeId: "sts_builtin_keychain",
              handle: "account-123",
              value: null,
              createdAt: 5,
              updatedAt: 6,
            },
          ],
          executions: [
            {
              id: "exe_1",
              workspaceId: scopeId,
              createdByAccountId: scopeId,
              status: "completed",
              code: "1 + 1",
              resultJson: "2",
              errorText: null,
              logsJson: null,
              startedAt: 10,
              completedAt: 11,
              createdAt: 10,
              updatedAt: 11,
            },
          ],
          executionInteractions: [],
          executionSteps: [],
        }, null, 2)}\n`,
      );

      const beforeMigration = yield* Effect.flip(loadLocalExecutorStateSnapshot(context));
      expect(beforeMigration.message).toContain("Expected 2, actual 1");

      const migratedPaths = yield* migrateLegacyLocalExecutorState(context);
      expect(migratedPaths).toContain(path);
      expect(yield* fs.exists(`${path}.legacy-backup`)).toBe(true);

      const loaded = yield* loadLocalExecutorStateSnapshot(context);
      const rewritten = yield* fs.readFileString(path, "utf8");

      expect(rewritten).not.toContain("\"handle\"");
      expect(rewritten).not.toContain("\"workspaceId\"");
      expect(rewritten).not.toContain("\"createdByAccountId\"");
      expect(loaded.secretMaterials).toEqual([
        {
          id: "sec_local",
          name: "Local Secret",
          purpose: "auth_material",
          storeId: "sts_builtin_local",
          createdAt: 3,
          updatedAt: 4,
        },
        {
          id: "sec_keychain",
          name: "Keychain Secret",
          purpose: "auth_material",
          storeId: "sts_builtin_keychain",
          createdAt: 5,
          updatedAt: 6,
        },
      ]);
      expect(loaded.secretMaterialStoredData).toEqual([
        {
          secretId: "sec_local",
          data: {
            value: "token-from-local",
          },
        },
        {
          secretId: "sec_keychain",
          data: {
            account: "account-123",
          },
        },
      ]);
      expect(loaded.executions[0]).toMatchObject({
        scopeId,
        createdByScopeId: scopeId,
      });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("runs executor state migrations before startup loads the state store", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* makeWorkspaceRoot();
      const homeStateDirectory = join(workspaceRoot, ".home");
      const homeConfigPath = join(workspaceRoot, ".executor-home.jsonc");
      const context = yield* resolveLocalWorkspaceContext({
        workspaceRoot,
        homeConfigPath,
        homeStateDirectory,
      });
      const scopeId = deriveLocalInstallation(context).scopeId;
      const path = localExecutorStatePath(context);
      yield* fs.makeDirectory(dirname(path), { recursive: true });
      yield* fs.writeFileString(
        path,
        `${JSON.stringify({
          version: 1,
          secretStores: [],
          secretMaterials: [
            {
              id: "sec_local",
              name: "Startup Secret",
              purpose: "auth_material",
              providerId: "local",
              handle: "local:start",
              value: "startup-token",
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          executions: [],
          executionInteractions: [],
          executionSteps: [],
        }, null, 2)}\n`,
      );

      const beforeStartup = yield* Effect.flip(loadLocalExecutorStateSnapshot(context));
      expect(beforeStartup.message).toContain("Expected 2, actual 1");

      yield* createLocalExecutorRepositoriesEffect({
        workspaceRoot,
        homeConfigPath,
        homeStateDirectory,
      });

      const loaded = yield* loadLocalExecutorStateSnapshot(context);
      expect(yield* fs.exists(`${path}.legacy-backup`)).toBe(true);
      expect(loaded.secretStores).toEqual([
        {
          id: "sts_builtin_local",
          scopeId,
          name: "Local Store",
          kind: "local",
          status: "connected",
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ]);
      expect(loaded.secretMaterialStoredData).toEqual([
        {
          secretId: "sec_local",
          data: {
            value: "startup-token",
          },
        },
      ]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
