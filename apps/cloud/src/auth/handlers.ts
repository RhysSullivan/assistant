import { HttpApi, HttpApiBuilder, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import { setCookie, deleteCookie, getCookie } from "@tanstack/react-start/server";

import { AUTH_PATHS, CloudAuthApi, CloudAuthPublicApi } from "./api";
import { SessionContext } from "./middleware";
import { UserStoreService } from "./context";
import { WorkOSAuth } from "./workos";
import { server } from "../env";

const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 7,
  secure: server.NODE_ENV === "production",
};

// ---------------------------------------------------------------------------
// Single non-protected API surface — public (login/callback) + session
// (me/logout/createOrganization). The session group has SessionAuth on it.
// ---------------------------------------------------------------------------

export const NonProtectedApi = HttpApi.make("cloudWeb")
  .add(CloudAuthPublicApi)
  .add(CloudAuthApi);

// ---------------------------------------------------------------------------
// Public auth handlers (no authentication required)
// ---------------------------------------------------------------------------

export const CloudAuthPublicHandlers = HttpApiBuilder.group(
  NonProtectedApi,
  "cloudAuthPublic",
  (handlers) =>
    handlers
      .handleRaw("login", () =>
        Effect.gen(function* () {
          const workos = yield* WorkOSAuth;
          const req = yield* HttpServerRequest.HttpServerRequest;
          // Prefer APP_URL (set explicitly in dev/prod config) since the
          // request's Host header is the internal proxy target in dev, not
          // the public URL WorkOS needs to redirect back to.
          const origin = server.APP_URL
            ? server.APP_URL
            : new URL(req.url, `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers["host"]}`).origin;
          const url = workos.getAuthorizationUrl(`${origin}${AUTH_PATHS.callback}`);
          return HttpServerResponse.redirect(url, { status: 302 });
        }),
      )
      .handleRaw("callback", ({ urlParams }) =>
        Effect.gen(function* () {
          const workos = yield* WorkOSAuth;
          const users = yield* UserStoreService;

          const result = yield* workos.authenticateWithCode(urlParams.code);

          // Mirror the account locally
          yield* users.use((s) => s.ensureAccount(result.user.id));

          let sealedSession = result.sealedSession;
          let organizationId = result.organizationId;

          // WorkOS doesn't host an org creation flow — if the user has no
          // org yet, create a default one on their behalf and refresh the
          // session so it includes the new org_id claim.
          if (!organizationId) {
            const name =
              [result.user.firstName, result.user.lastName]
                .filter(Boolean)
                .join(" ") || result.user.email;
            const org = yield* workos.createOrganization(`${name}'s Workspace`);
            yield* workos.createMembership(org.id, result.user.id);
            yield* users.use((s) =>
              s.upsertOrganization({ id: org.id, name: org.name }),
            );

            if (sealedSession) {
              const refreshed = yield* workos.refreshSession(sealedSession, org.id);
              if (refreshed) sealedSession = refreshed;
            }
            organizationId = org.id;
          } else {
            yield* users.use((s) =>
              s.upsertOrganization({
                id: organizationId!,
                name: "Organization",
              }),
            );
          }

          if (!sealedSession) {
            return HttpServerResponse.text("Failed to create session", { status: 500 });
          }

          setCookie("wos-session", sealedSession, COOKIE_OPTIONS);
          return HttpServerResponse.redirect("/", { status: 302 });
        }),
      ),
);

// ---------------------------------------------------------------------------
// Session auth handlers (require session, may or may not have an org)
// ---------------------------------------------------------------------------

export const CloudSessionAuthHandlers = HttpApiBuilder.group(
  NonProtectedApi,
  "cloudAuth",
  (handlers) =>
    handlers
      .handle("me", () =>
        Effect.gen(function* () {
          const session = yield* SessionContext;
          const users = yield* UserStoreService;
          const org = session.organizationId
            ? yield* users.use((s) => s.getOrganization(session.organizationId!))
            : null;

          return {
            user: {
              id: session.accountId,
              email: session.email,
              name: session.name,
              avatarUrl: session.avatarUrl,
            },
            organization: org ? { id: org.id, name: org.name } : null,
          };
        }),
      )
      .handleRaw("logout", () =>
        Effect.sync(() => {
          deleteCookie("wos-session", { path: "/" });
          return HttpServerResponse.redirect("/", { status: 302 });
        }),
      )
      .handle("createOrganization", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext;
          const workos = yield* WorkOSAuth;
          const users = yield* UserStoreService;

          // Create the org in WorkOS
          const org = yield* workos.createOrganization(payload.name);

          // Add the current user as a member
          yield* workos.createMembership(org.id, session.accountId);

          // Mirror locally
          yield* users.use((s) =>
            s.upsertOrganization({ id: org.id, name: org.name }),
          );

          // Refresh the session with the new org context
          const currentSession = getCookie("wos-session") ?? null;
          if (currentSession) {
            const newSession = yield* workos.refreshSession(currentSession, org.id);
            if (newSession) {
              setCookie("wos-session", newSession, COOKIE_OPTIONS);
            }
          }
        }),
      ),
);
