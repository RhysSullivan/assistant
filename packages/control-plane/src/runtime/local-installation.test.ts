import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createSqlControlPlaneRuntime } from "./index";
import { getOrProvisionLocalInstallation } from "./local-installation";

const makeRuntime = Effect.acquireRelease(
  createSqlControlPlaneRuntime({ localDataDir: ":memory:" }),
  (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
);

describe("local-installation", () => {
  it.scoped("provisions a local account, organization, and workspace on first boot", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;

      const account = yield* runtime.persistence.rows.accounts.getById(installation.accountId);
      const organization = yield* runtime.persistence.rows.organizations.getById(
        installation.organizationId,
      );
      const workspace = yield* runtime.persistence.rows.workspaces.getById(
        installation.workspaceId,
      );

      expect(account._tag).toBe("Some");
      expect(organization._tag).toBe("Some");
      expect(workspace._tag).toBe("Some");
    }),
  );

  it.scoped("is idempotent when loading the default local installation", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const first = runtime.localInstallation;
      const second = yield* getOrProvisionLocalInstallation(runtime.persistence.rows);

      expect(second.id).toBe(first.id);
      expect(second.accountId).toBe(first.accountId);
      expect(second.organizationId).toBe(first.organizationId);
      expect(second.workspaceId).toBe(first.workspaceId);
    }),
  );
});
