// ---------------------------------------------------------------------------
// HTTP API middleware — live implementations (server-only).
// Imports the WorkOS SDK so it must NOT be pulled into the client bundle.
// ---------------------------------------------------------------------------

import { Effect, Layer } from "effect";

import { IdentityProvider } from "../identity/provider";
import { NoOrganization, OrgAuth, SessionAuth, Unauthorized } from "./middleware";

export const SessionAuthLive = Layer.effect(
  SessionAuth,
  Effect.gen(function* () {
    const identity = yield* IdentityProvider;
    return SessionAuth.of({
      cookie: (sealedSession) =>
        Effect.gen(function* () {
          const result = yield* identity
            .authenticateSealedSession(sealedSession)
            .pipe(Effect.orElseSucceed(() => null));

          if (!result) {
            return yield* new Unauthorized();
          }

          return {
            accountId: result.accountId,
            email: result.email,
            name: result.name,
            avatarUrl: result.avatarUrl ?? null,
            organizationId: result.organizationId ?? null,
            sealedSession: result.sealedSession,
            refreshedSession: result.refreshedSession ?? null,
          };
        }),
    });
  }),
);

export const OrgAuthLive = Layer.effect(
  OrgAuth,
  Effect.gen(function* () {
    const identity = yield* IdentityProvider;
    return OrgAuth.of({
      cookie: (sealedSession) =>
        Effect.gen(function* () {
          const result = yield* identity
            .authenticateSealedSession(sealedSession)
            .pipe(Effect.orElseSucceed(() => null));

          if (!result) {
            return yield* new Unauthorized();
          }

          if (!result.organizationId) {
            return yield* new NoOrganization();
          }

          return {
            accountId: result.accountId,
            organizationId: result.organizationId,
            email: result.email,
            name: result.name,
            avatarUrl: result.avatarUrl ?? null,
          };
        }),
    });
  }),
);
