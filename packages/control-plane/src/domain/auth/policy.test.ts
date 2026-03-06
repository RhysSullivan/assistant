import { describe, expect, it } from "@effect/vitest";
import { AccountIdSchema, WorkspaceIdSchema } from "#schema";
import * as Effect from "effect/Effect";

import { Actor, createAllowAllActor } from "./actor";
import { requirePermission, withPolicy } from "./policy";

describe("control-plane-domain policy", () => {
  it.effect("runs protected effect when permission is granted", () =>
    Effect.gen(function* () {
      const accountId = AccountIdSchema.make("acc_1");
      const workspaceId = WorkspaceIdSchema.make("ws_1");

      const principal = {
        accountId,
        provider: "local" as const,
        subject: "local:acc_1",
        email: null,
        displayName: null,
      };

      const result = yield* withPolicy(
        requirePermission({
          permission: "workspace:read",
          workspaceId,
        }),
      )(Effect.succeed("ok")).pipe(
        Effect.provideService(Actor, createAllowAllActor(principal)),
      );

      expect(result).toBe("ok");
    }),
  );
});
