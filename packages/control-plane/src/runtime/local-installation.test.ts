import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createControlPlaneRuntime } from "./index";
import { getOrProvisionLocalInstallation } from "./local-installation";
import { resolveLocalWorkspaceContext } from "./local-config";

const TEST_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "executor-local-installation-"));

const makeRuntime = Effect.acquireRelease(
  createControlPlaneRuntime({
    localDataDir: ":memory:",
    workspaceRoot: TEST_WORKSPACE_ROOT,
  }),
  (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
);

describe("local-installation", () => {
  it.scoped("derives a stable local identity on first boot", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;

      expect(installation.id.startsWith("local_")).toBe(true);
      expect(installation.accountId).toBe("acc_local_default");
      expect(installation.organizationId).toBe("org_local_personal");
      expect(installation.workspaceId.startsWith("ws_local_")).toBe(true);
      expect(existsSync(join(TEST_WORKSPACE_ROOT, ".executor", "executor.jsonc"))).toBe(false);
    }),
    60_000,
  );

  it.scoped("is idempotent when loading the default local installation", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const context = yield* Effect.promise(() =>
        resolveLocalWorkspaceContext({ workspaceRoot: TEST_WORKSPACE_ROOT }),
      );

      const first = runtime.localInstallation;
      const second = yield* getOrProvisionLocalInstallation({
        rows: runtime.persistence.rows,
        context,
      });

      expect(second.id).toBe(first.id);
      expect(second.accountId).toBe(first.accountId);
      expect(second.organizationId).toBe(first.organizationId);
      expect(second.workspaceId).toBe(first.workspaceId);
    }),
  );
});
