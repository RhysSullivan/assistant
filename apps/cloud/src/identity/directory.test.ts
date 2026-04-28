import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { UserStoreService } from "../auth/context";
import { IdentityDirectory } from "./directory";
import { IdentityProvider } from "./provider";
import type { IdentityMembership, IdentityOrganization } from "./types";

const org: IdentityOrganization = { id: "org_1", name: "Acme" };
const activeMembership: IdentityMembership = {
  id: "mem_1",
  accountId: "user_1",
  organizationId: org.id,
  status: "active",
  roleSlug: "admin",
};

type LocalMembership = {
  readonly accountId: string;
  readonly organizationId: string;
  readonly status: string;
  readonly roleSlug: string;
};

const makeDirectory = (options: {
  readonly localMemberships?: ReadonlyArray<LocalMembership>;
  readonly providerMemberships?: ReadonlyArray<IdentityMembership>;
}) => {
  const localMemberships = [...(options.localMemberships ?? [])];
  const providerMemberships = options.providerMemberships ?? [activeMembership];
  let providerRefreshes = 0;

  const UserStoreTest = Layer.succeed(UserStoreService, {
    use: <A>(fn: (store: {
      getOrganization: (id: string) => Promise<IdentityOrganization | null>;
      upsertOrganization: (input: IdentityOrganization) => Promise<IdentityOrganization>;
      getMembership: (
        accountId: string,
        organizationId: string,
      ) => Promise<LocalMembership | null>;
      listMembershipsForAccount: (accountId: string) => Promise<ReadonlyArray<LocalMembership>>;
      upsertMembership: (input: LocalMembership) => Promise<LocalMembership>;
    }) => Promise<A>) =>
      Effect.promise(() =>
        fn({
          getOrganization: async (id) => (id === org.id ? org : null),
          upsertOrganization: async (input) => input,
          getMembership: async (accountId, organizationId) =>
            localMemberships.find(
              (m) => m.accountId === accountId && m.organizationId === organizationId,
            ) ?? null,
          listMembershipsForAccount: async (accountId) =>
            localMemberships.filter((m) => m.accountId === accountId),
          upsertMembership: async (input) => {
            localMemberships.push(input);
            return input;
          },
        }),
      ),
  } as unknown as UserStoreService["Type"]);

  const IdentityProviderTest = Layer.succeed(IdentityProvider, {
    authenticateSealedSession: () => Effect.succeed(null),
    authenticateRequest: () => Effect.succeed(null),
    listUserMemberships: () =>
      Effect.sync(() => {
        providerRefreshes++;
        return providerMemberships;
      }),
    listOrganizationMembers: () => Effect.succeed([]),
    listOrganizationRoles: () => Effect.succeed([]),
    getOrganization: () => Effect.succeed(org),
    refreshSession: () => Effect.succeed(null),
  } as IdentityProvider["Type"]);

  return {
    get providerRefreshes() {
      return providerRefreshes;
    },
    layer: IdentityDirectory.Live.pipe(
      Layer.provideMerge(UserStoreTest),
      Layer.provideMerge(IdentityProviderTest),
    ) as Layer.Layer<IdentityDirectory, never, never>,
  };
};

describe("IdentityDirectory", () => {
  it.effect("authorizes from an active local membership without provider refresh", () =>
    Effect.gen(function* () {
      const directory = makeDirectory({ localMemberships: [activeMembership] });

      const result = yield* Effect.provide(
        Effect.gen(function* () {
          const service = yield* IdentityDirectory;
          return yield* service.authorizeOrganization("user_1", "org_1");
        }),
        directory.layer,
      );

      expect(result).toEqual(org);
      expect(directory.providerRefreshes).toBe(0);
    }),
  );

  it.effect("falls back to provider refresh when local membership is missing", () =>
    Effect.gen(function* () {
      const directory = makeDirectory({});

      const result = yield* Effect.provide(
        Effect.gen(function* () {
          const service = yield* IdentityDirectory;
          return yield* service.authorizeOrganization("user_1", "org_1");
        }),
        directory.layer,
      );

      expect(result).toEqual(org);
      expect(directory.providerRefreshes).toBe(1);
    }),
  );

  it.effect("does not authorize inactive memberships", () =>
    Effect.gen(function* () {
      const directory = makeDirectory({
        localMemberships: [{ ...activeMembership, status: "inactive" }],
        providerMemberships: [{ ...activeMembership, status: "inactive" }],
      });

      const result = yield* Effect.provide(
        Effect.gen(function* () {
          const service = yield* IdentityDirectory;
          return yield* service.authorizeOrganization("user_1", "org_1");
        }),
        directory.layer,
      );

      expect(result).toBeNull();
      expect(directory.providerRefreshes).toBe(1);
    }),
  );
});
