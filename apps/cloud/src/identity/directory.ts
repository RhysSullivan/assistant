import { Context, Effect, Layer } from "effect";

import { UserStoreService } from "../auth/context";
import { WorkOSError, type UserStoreError } from "../auth/errors";
import { IdentityProvider } from "./provider";
import type { IdentityMembership, IdentityOrganization } from "./types";
import type { IdentityMemberProfile } from "./types";

export class IdentityDirectory extends Context.Tag("@executor/cloud/IdentityDirectory")<
  IdentityDirectory,
  {
    readonly getOrganization: (
      organizationId: string,
    ) => Effect.Effect<IdentityOrganization | null, UserStoreError | WorkOSError>;
    readonly authorizeOrganization: (
      accountId: string,
      organizationId: string,
    ) => Effect.Effect<IdentityOrganization | null, UserStoreError | WorkOSError>;
    readonly listUserOrganizations: (
      accountId: string,
    ) => Effect.Effect<ReadonlyArray<IdentityOrganization>, UserStoreError | WorkOSError>;
    readonly listOrganizationMembers: (
      organizationId: string,
    ) => Effect.Effect<ReadonlyArray<IdentityMemberProfile>, UserStoreError>;
    readonly requireRole: (
      accountId: string,
      organizationId: string,
      roleSlug: string,
    ) => Effect.Effect<boolean, UserStoreError | WorkOSError>;
    readonly refreshAccountMemberships: (
      accountId: string,
    ) => Effect.Effect<ReadonlyArray<IdentityMembership>, UserStoreError | WorkOSError>;
  }
>() {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const users = yield* UserStoreService;
      const provider = yield* IdentityProvider;

      const getOrganization = (organizationId: string) =>
        Effect.gen(function* () {
          const existing = yield* users.use((store) => store.getOrganization(organizationId));
          if (existing) return { id: existing.id, name: existing.name };

          const fresh = yield* provider.getOrganization(organizationId);
          const saved = yield* users.use((store) =>
            store.upsertOrganization({
              id: fresh.id,
              name: fresh.name,
              externalId: fresh.id,
              identityProvider: "workos",
            }),
          );
          return { id: saved.id, name: saved.name };
        });

      const refreshAccountMemberships = (accountId: string) =>
        Effect.gen(function* () {
          const memberships = yield* provider.listUserMemberships(accountId);
          for (const membership of memberships) {
            const org = yield* provider.getOrganization(membership.organizationId);
            yield* users.use((store) =>
              store.upsertOrganization({
                id: org.id,
                name: org.name,
                externalId: org.id,
                identityProvider: "workos",
              }),
            );
            yield* users.use((store) =>
              store.upsertMembership({
                accountId: membership.accountId,
                organizationId: membership.organizationId,
                externalId: membership.id,
                identityProvider: "workos",
                status: membership.status,
                roleSlug: membership.roleSlug,
              }),
            );
          }
          return memberships;
        });

      const authorizeOrganization = (accountId: string, organizationId: string) =>
        Effect.gen(function* () {
          const local = yield* users.use((store) =>
            store.getMembership(accountId, organizationId),
          );
          if (local?.status === "active") {
            return yield* getOrganization(organizationId);
          }

          const fresh = yield* refreshAccountMemberships(accountId);
          const active = fresh.find(
            (membership) =>
              membership.organizationId === organizationId && membership.status === "active",
          );
          if (!active) return null;
          return yield* getOrganization(organizationId);
        });

      const listActiveOrganizations = (memberships: ReadonlyArray<{ organizationId: string }>) =>
        Effect.all(
          memberships.map((membership) => getOrganization(membership.organizationId)),
          { concurrency: 5 },
        ).pipe(
          Effect.map((orgs) =>
            orgs.filter((org): org is IdentityOrganization => org != null),
          ),
        );

      return IdentityDirectory.of({
        getOrganization,
        authorizeOrganization,
        listUserOrganizations: (accountId) =>
          Effect.gen(function* () {
            const local = yield* users.use((store) => store.listMembershipsForAccount(accountId));
            const active = local.filter((membership) => membership.status === "active");
            if (active.length > 0) return yield* listActiveOrganizations(active);

            const fresh = yield* refreshAccountMemberships(accountId);
            return yield* listActiveOrganizations(
              fresh.filter((membership) => membership.status === "active"),
            );
          }),
        listOrganizationMembers: (organizationId) =>
          Effect.gen(function* () {
            const memberships = yield* users.use((store) =>
              store.listMembershipsForOrganization(organizationId),
            );
            return yield* Effect.all(
              memberships.map((membership) =>
                Effect.gen(function* () {
                  const account = yield* users.use((store) =>
                    store.getAccount(membership.accountId),
                  );
                  return {
                    id: membership.externalId ?? `${membership.accountId}:${membership.organizationId}`,
                    accountId: membership.accountId,
                    organizationId: membership.organizationId,
                    status: membership.status,
                    roleSlug: membership.roleSlug,
                    email: account?.email ?? "",
                    name: account?.name ?? null,
                    avatarUrl: account?.avatarUrl ?? null,
                    lastActiveAt: null,
                  } satisfies IdentityMemberProfile;
                }),
              ),
              { concurrency: 5 },
            );
          }),
        requireRole: (accountId, organizationId, roleSlug) =>
          Effect.gen(function* () {
            const local = yield* users.use((store) =>
              store.getMembership(accountId, organizationId),
            );
            if (local?.status === "active" && local.roleSlug === roleSlug) return true;

            const fresh = yield* refreshAccountMemberships(accountId);
            return fresh.some(
              (membership) =>
                membership.organizationId === organizationId &&
                membership.status === "active" &&
                membership.roleSlug === roleSlug,
            );
          }),
        refreshAccountMemberships,
      });
    }),
  );
}
