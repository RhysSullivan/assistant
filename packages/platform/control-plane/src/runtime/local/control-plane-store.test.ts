import { existsSync, mkdtempSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ResolvedLocalWorkspaceContext } from "./config";
import {
  loadLocalControlPlaneState,
  localControlPlaneStatePath,
  writeLocalControlPlaneState,
} from "./control-plane-store";

const makeContext = (): ResolvedLocalWorkspaceContext => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "executor-control-plane-store-"));

  return {
    cwd: workspaceRoot,
    workspaceRoot,
    workspaceName: "executor-control-plane-store",
    configDirectory: join(workspaceRoot, ".executor"),
    projectConfigPath: join(workspaceRoot, ".executor", "executor.jsonc"),
    homeConfigPath: join(workspaceRoot, ".executor-home.jsonc"),
    homeStateDirectory: join(workspaceRoot, ".executor-home-state"),
    artifactsDirectory: join(workspaceRoot, ".executor", "artifacts"),
    stateDirectory: join(workspaceRoot, ".executor", "state"),
  };
};

describe("local-control-plane-store", () => {
  it.effect("stores secret-bearing control-plane state outside the workspace", () =>
    Effect.gen(function* () {
      const context = makeContext();
      const expectedPath = localControlPlaneStatePath(context);
      const workspacePath = join(context.stateDirectory, "control-plane-state.json");

      yield* writeLocalControlPlaneState({
        context,
        state: {
          version: 1,
          authArtifacts: [],
          authLeases: [],
          sourceOauthClients: [],
          workspaceOauthClients: [],
          providerAuthGrants: [],
          sourceAuthSessions: [],
          secretMaterials: [],
          executions: [],
          executionInteractions: [],
          executionSteps: [],
        },
      });

      expect(expectedPath.startsWith(context.homeStateDirectory)).toBe(true);
      expect(existsSync(expectedPath)).toBe(true);
      expect(existsSync(workspacePath)).toBe(false);

      const loaded = yield* loadLocalControlPlaneState(context);
      expect(loaded.version).toBe(1);
      expect(loaded.secretMaterials).toEqual([]);

      if (process.platform !== "win32") {
        expect(statSync(expectedPath).mode & 0o777).toBe(0o600);
      }
    }),
  );
});
