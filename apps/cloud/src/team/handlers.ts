import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AuthContext } from "../auth/middleware";
import { WorkOSAuth } from "../auth/workos";
import { TeamOrgApi } from "./compose";
import { Forbidden } from "./api";

const requireAdmin = Effect.gen(function* () {
  const auth = yield* AuthContext;
  const workos = yield* WorkOSAuth;
  const memberships = yield* workos.listOrgMembers(auth.organizationId);
  const currentMembership = memberships.data.find((m) => m.userId === auth.accountId);
  if (!currentMembership || currentMembership.role?.slug !== "admin") {
    return yield* new Forbidden();
  }
});

export const TeamHandlers = HttpApiBuilder.group(TeamOrgApi, "team", (handlers) =>
  handlers
    .handle("listMembers", () =>
      Effect.gen(function* () {
        const auth = yield* AuthContext;
        const workos = yield* WorkOSAuth;

        const memberships = yield* workos.listOrgMembers(auth.organizationId);

        const members = yield* Effect.all(
          memberships.data.map((m) =>
            Effect.gen(function* () {
              const user = yield* workos.getUser(m.userId);
              return {
                id: m.id,
                userId: m.userId,
                email: user.email,
                name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
                avatarUrl: user.profilePictureUrl ?? null,
                role: m.role?.slug ?? "member",
                status: m.status,
                lastActiveAt: user.lastSignInAt ?? null,
                isCurrentUser: m.userId === auth.accountId,
              };
            }),
          ),
          { concurrency: 5 },
        );

        return { members };
      }),
    )
    .handle("listRoles", () =>
      Effect.gen(function* () {
        const auth = yield* AuthContext;
        const workos = yield* WorkOSAuth;

        const result = yield* workos.listOrgRoles(auth.organizationId);

        return {
          roles: result.data.map((r) => ({
            slug: r.slug,
            name: r.name,
          })),
        };
      }),
    )
    .handle("invite", ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin;
        const auth = yield* AuthContext;
        const workos = yield* WorkOSAuth;

        const invitation = yield* workos.sendInvitation({
          email: payload.email,
          organizationId: auth.organizationId,
          roleSlug: payload.roleSlug,
        });

        return { id: invitation.id, email: invitation.email };
      }),
    )
    .handle("removeMember", ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdmin;
        const workos = yield* WorkOSAuth;
        yield* workos.deleteOrgMembership(path.membershipId);
        return { success: true };
      }),
    )
    .handle("updateMemberRole", ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin;
        const workos = yield* WorkOSAuth;
        yield* workos.updateOrgMembershipRole(path.membershipId, payload.roleSlug);
        return { success: true };
      }),
    ),
);
