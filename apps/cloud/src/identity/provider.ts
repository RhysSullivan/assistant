import { Context, Effect, Layer, Redacted } from "effect";

import { WorkOSError } from "../auth/errors";
import { WorkOSAuth } from "../auth/workos";
import type {
  IdentityMemberProfile,
  IdentityMembership,
  IdentityOrganization,
  IdentitySession,
} from "./types";

type WorkOSSession = {
  readonly userId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly avatarUrl: string | null | undefined;
  readonly organizationId: string | null | undefined;
  readonly refreshedSession: string | undefined;
};

export class IdentityProvider extends Context.Tag("@executor/cloud/IdentityProvider")<
  IdentityProvider,
  {
    readonly authenticateSealedSession: (
      sealedSession: Redacted.Redacted<string>,
    ) => Effect.Effect<IdentitySession | null, WorkOSError>;
    readonly authenticateRequest: (
      request: Request,
    ) => Effect.Effect<IdentitySession | null, WorkOSError>;
    readonly listUserMemberships: (
      accountId: string,
    ) => Effect.Effect<ReadonlyArray<IdentityMembership>, WorkOSError>;
    readonly listOrganizationMembers: (
      organizationId: string,
    ) => Effect.Effect<ReadonlyArray<IdentityMemberProfile>, WorkOSError>;
    readonly listOrganizationRoles: (
      organizationId: string,
    ) => Effect.Effect<ReadonlyArray<{ slug: string; name: string }>, WorkOSError>;
    readonly getOrganization: (
      organizationId: string,
    ) => Effect.Effect<IdentityOrganization, WorkOSError>;
    readonly refreshSession: (
      sealedSession: string,
      organizationId?: string,
    ) => Effect.Effect<string | null, WorkOSError>;
  }
>() {
  static WorkOSLive = Layer.effect(
    this,
    Effect.gen(function* () {
      const workos = yield* WorkOSAuth;

      const toSession = (session: WorkOSSession | null, sealedSession: string) => {
        if (!session) return null;
        return {
          accountId: session.userId,
          email: session.email,
          name: `${session.firstName ?? ""} ${session.lastName ?? ""}`.trim() || null,
          avatarUrl: session.avatarUrl ?? null,
          organizationId: session.organizationId ?? null,
          sealedSession: session.refreshedSession ?? sealedSession,
          refreshedSession: session.refreshedSession ?? null,
        } satisfies IdentitySession;
      };

      return IdentityProvider.of({
        authenticateSealedSession: (sealedSession) =>
          Effect.map(
            workos.authenticateSealedSession(Redacted.value(sealedSession)),
            (session) => toSession(session, Redacted.value(sealedSession)),
          ),
        authenticateRequest: (request) =>
          Effect.map(workos.authenticateRequest(request), (session) =>
            toSession(session, parseCookie(request.headers.get("cookie"), "wos-session") ?? ""),
          ),
        listUserMemberships: (accountId) =>
          Effect.map(workos.listUserMemberships(accountId), (result) =>
            result.data.map((membership) => ({
              id: membership.id,
              accountId: membership.userId,
              organizationId: membership.organizationId,
              status: membership.status,
              roleSlug: membership.role?.slug ?? "member",
            })),
          ),
        listOrganizationMembers: (organizationId) =>
          Effect.gen(function* () {
            const result = yield* workos.listOrgMembers(organizationId);
            return yield* Effect.all(
              result.data.map((membership) =>
                Effect.gen(function* () {
                  const user = yield* workos.getUser(membership.userId);
                  return {
                    id: membership.id,
                    accountId: membership.userId,
                    organizationId: membership.organizationId,
                    status: membership.status,
                    roleSlug: membership.role?.slug ?? "member",
                    email: user.email,
                    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
                    avatarUrl: user.profilePictureUrl ?? null,
                    lastActiveAt: user.lastSignInAt ?? null,
                  };
                }),
              ),
              { concurrency: 5 },
            );
          }),
        listOrganizationRoles: (organizationId) =>
          Effect.map(workos.listOrgRoles(organizationId), (result) =>
            result.data.map((role) => ({ slug: role.slug, name: role.name })),
          ),
        getOrganization: (organizationId) =>
          Effect.map(workos.getOrganization(organizationId), (org) => ({
            id: org.id,
            name: org.name,
          })),
        refreshSession: workos.refreshSession,
      });
    }),
  );
}

const parseCookie = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) || null : null;
};
