import { describe, expect, it } from "@effect/vitest";
import { AccountIdSchema, WorkspaceIdSchema } from "#schema";
import * as Effect from "effect/Effect";

import {
  createActor,
  ActorForbiddenError,
  ActorUnauthenticatedError,
} from "./actor";

describe("control-plane-domain actor", () => {
  it.effect("allows workspace permissions from active membership", () =>
    Effect.gen(function* () {
      const accountId = AccountIdSchema.make("acc_1");
      const workspaceId = WorkspaceIdSchema.make("ws_1");

      const actor = yield* createActor({
        principal: {
          accountId,
          provider: "local",
          subject: "local:acc_1",
          email: null,
          displayName: null,
        },
        workspaceMemberships: [
          {
            accountId,
            workspaceId,
            role: "editor",
            status: "active",
            grantedAt: 1,
            updatedAt: 1,
          },
        ],
        organizationMemberships: [],
      });

      yield* actor.requirePermission({
        permission: "sources:write",
        workspaceId,
      });
    }),
  );

  it.effect("denies permission when role is insufficient", () =>
    Effect.gen(function* () {
      const accountId = AccountIdSchema.make("acc_1");
      const workspaceId = WorkspaceIdSchema.make("ws_1");

      const actor = yield* createActor({
        principal: {
          accountId,
          provider: "local",
          subject: "local:acc_1",
          email: null,
          displayName: null,
        },
        workspaceMemberships: [
          {
            accountId,
            workspaceId,
            role: "viewer",
            status: "active",
            grantedAt: 1,
            updatedAt: 1,
          },
        ],
        organizationMemberships: [],
      });

      const denied = yield* Effect.either(
        actor.requirePermission({
          permission: "sources:write",
          workspaceId,
        }),
      );

      expect(denied._tag).toBe("Left");
      if (denied._tag === "Left") {
        expect(denied.left).toBeInstanceOf(ActorForbiddenError);
      }
    }),
  );

  it.effect("fails when principal is missing", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        createActor({
          principal: null,
          workspaceMemberships: [],
          organizationMemberships: [],
        }),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ActorUnauthenticatedError);
      }
    }),
  );
});
