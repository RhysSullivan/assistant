import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ResolvedLocalWorkspaceContext } from "./config";
import {
  loadLocalExecutorStateSnapshot,
  localExecutorStatePath,
  writeLocalExecutorStateSnapshot,
} from "./executor-state-store";

const makeContext = (): Effect.Effect<
  ResolvedLocalWorkspaceContext,
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const workspaceRoot = yield* fs.makeTempDirectory({
      directory: tmpdir(),
      prefix: "executor-state-store-",
    }).pipe(Effect.orDie);

    return {
      cwd: workspaceRoot,
      workspaceRoot,
      workspaceName: "executor-state-store",
      configDirectory: join(workspaceRoot, ".executor"),
      projectConfigPath: join(workspaceRoot, ".executor", "executor.jsonc"),
      homeConfigPath: join(workspaceRoot, ".executor-home.jsonc"),
      homeStateDirectory: join(workspaceRoot, ".executor-home-state"),
      artifactsDirectory: join(workspaceRoot, ".executor", "artifacts"),
      stateDirectory: join(workspaceRoot, ".executor", "state"),
    };
  });

describe("local-executor-state-store", () => {
  it.effect("stores secret-bearing executor state outside the workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const context = yield* makeContext();
      const expectedPath = localExecutorStatePath(context);
      const workspacePath = join(context.stateDirectory, "executor-state.json");

      yield* writeLocalExecutorStateSnapshot({
        context,
        state: {
          version: 1,
          authArtifacts: [],
          authLeases: [],
          sourceOauthClients: [],
          scopeOauthClients: [],
          providerAuthGrants: [],
          sourceAuthSessions: [],
          secretMaterials: [],
          executions: [],
          executionInteractions: [],
          executionSteps: [],
        },
      });

      expect(expectedPath.startsWith(context.homeStateDirectory)).toBe(true);
      expect(yield* fs.exists(expectedPath)).toBe(true);
      expect(yield* fs.exists(workspacePath)).toBe(false);

      const loaded = yield* loadLocalExecutorStateSnapshot(context);
      expect(loaded.version).toBe(1);
      expect(loaded.secretMaterials).toEqual([]);

      if (process.platform !== "win32") {
        expect((yield* fs.stat(expectedPath)).mode & 0o777).toBe(0o600);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("migrates legacy workspace-shaped executor state on load", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const context = yield* makeContext();
      const path = localExecutorStatePath(context);

      yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
        Effect.orDie,
      );
      yield* fs.writeFileString(
        path,
        `${JSON.stringify({
          version: 1,
          authArtifacts: [
            {
              id: "auth_art_test",
              workspaceId: "ws_test",
              sourceId: "github",
              actorAccountId: "acc_test",
              slot: "runtime",
              artifactKind: "static_bearer",
              configJson:
                "{\"headerName\":\"Authorization\",\"prefix\":\"Bearer \",\"token\":{\"providerId\":\"test\",\"handle\":\"secret_test\"}}",
              grantSetJson: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          authLeases: [],
          sourceOauthClients: [],
          workspaceOauthClients: [],
          providerAuthGrants: [],
          sourceAuthSessions: [],
          secretMaterials: [
            {
              id: "secret_test",
              providerId: "test",
              handle: "secret_test",
              name: null,
              purpose: "auth_material",
              value: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          executions: [
            {
              id: "exec_test",
              workspaceId: "ws_test",
              createdByAccountId: "acc_test",
              status: "completed",
              code: "return 1;",
              resultJson: "1",
              errorText: null,
              logsJson: null,
              startedAt: 1,
              completedAt: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          executionInteractions: [],
          executionSteps: [],
        }, null, 2)}\n`,
        { mode: 0o600 },
      ).pipe(Effect.orDie);

      const loaded = yield* loadLocalExecutorStateSnapshot(context);
      expect(loaded.authArtifacts[0]?.scopeId).toBe("ws_test");
      expect(loaded.authArtifacts[0]?.actorScopeId).toBe("acc_test");
      expect(loaded.executions[0]?.scopeId).toBe("ws_test");
      expect(loaded.executions[0]?.createdByScopeId).toBe("acc_test");
      expect(loaded.scopeOauthClients).toEqual([]);

      const migratedContent = yield* fs.readFileString(path, "utf8").pipe(
        Effect.orDie,
      );
      expect(migratedContent.includes("\"workspaceId\"")).toBe(false);
      expect(migratedContent.includes("\"actorAccountId\"")).toBe(false);
      expect(migratedContent.includes("\"createdByAccountId\"")).toBe(false);
      expect(migratedContent.includes("\"workspaceOauthClients\"")).toBe(false);
      expect(migratedContent.includes("\"scopeId\"")).toBe(true);
      expect(migratedContent.includes("\"actorScopeId\"")).toBe(true);
      expect(migratedContent.includes("\"createdByScopeId\"")).toBe(true);
      expect(migratedContent.includes("\"scopeOauthClients\"")).toBe(true);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
