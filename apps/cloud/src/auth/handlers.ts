import { HttpApiBuilder, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";

import { addGroup } from "@executor/api";
import { CloudAuthApi } from "./api";
import { AuthContext, UserStoreService } from "./context";
import { WorkOSAuth, makeSessionCookie, clearSessionCookie } from "./workos";

const ApiWithCloudAuth = addGroup(CloudAuthApi);

export const CloudAuthHandlers = HttpApiBuilder.group(
  ApiWithCloudAuth,
  "cloudAuth",
  (handlers) =>
    handlers
      .handle("me", () =>
        Effect.gen(function* () {
          const auth = yield* AuthContext;
          const users = yield* UserStoreService;
          const team = yield* users.use((s) => s.getTeam(auth.teamId));

          return {
            user: {
              id: auth.userId,
              email: auth.email,
              name: auth.name,
              avatarUrl: auth.avatarUrl,
            },
            team: team ? { id: team.id, name: team.name } : null,
          };
        }),
      )
      .handleRaw("login", () =>
        Effect.gen(function* () {
          const workos = yield* WorkOSAuth;
          const baseUrl = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;
          const url = workos.getAuthorizationUrl(`${baseUrl}/auth/callback`);
          return HttpServerResponse.redirect(url, { status: 302 });
        }),
      )
      .handleRaw("callback", ({ urlParams }) =>
        Effect.gen(function* () {
          const workos = yield* WorkOSAuth;
          const users = yield* UserStoreService;

          const result = yield* workos.authenticateWithCode(urlParams.code);
          const workosUser = result.user;

          const user = yield* users.use((s) =>
            s.upsertUser({
              id: workosUser.id,
              email: workosUser.email,
              name: `${workosUser.firstName ?? ""} ${workosUser.lastName ?? ""}`.trim() || undefined,
              avatarUrl: workosUser.profilePictureUrl ?? undefined,
            }),
          );

          const resolveTeam = Effect.gen(function* () {
            const pending = yield* users.use((s) => s.getPendingInvitations(user.email));
            if (pending.length > 0) {
              const invitation = pending[0]!;
              yield* users.use((s) => s.acceptInvitation(invitation.id));
              yield* users.use((s) => s.addMember(invitation.teamId, user.id, "member"));
              return invitation.teamId;
            }

            const teams = yield* users.use((s) => s.getTeamsForUser(user.id));
            if (teams.length > 0) return teams[0]!.teamId;

            const team = yield* users.use((s) =>
              s.createTeam(`${user.name ?? user.email}'s Team`),
            );
            yield* users.use((s) => s.addMember(team.id, user.id, "owner"));
            return team.id;
          });

          const teamId = yield* resolveTeam;

          const sealedSession = result.sealedSession;
          if (!sealedSession) {
            return HttpServerResponse.text("Failed to create session", { status: 500 });
          }

          return HttpServerResponse.redirect("/", {
            status: 302,
            headers: {
              "Set-Cookie": [
                makeSessionCookie(sealedSession),
                `executor_team=${teamId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
              ].join(", "),
            },
          });
        }),
      )
      .handleRaw("logout", () =>
        Effect.succeed(
          HttpServerResponse.redirect("/", {
            status: 302,
            headers: {
              "Set-Cookie": [
                clearSessionCookie(),
                "executor_team=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
              ].join(", "),
            },
          }),
        ),
      ),
);
