import { type SqlControlPlaneRows } from "#persistence";
import type {
  Account,
  LocalInstallation,
  Organization,
  OrganizationMembership,
  Workspace,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const LOCAL_INSTALLATION_ID = "local_default" as LocalInstallation["id"];

const buildAccount = (now: number): Account => {
  const id = `acc_${crypto.randomUUID()}` as Account["id"];

  return {
    id,
    provider: "local",
    subject: `local:${id}`,
    email: null,
    displayName: "Local User",
    createdAt: now,
    updatedAt: now,
  };
};

const buildOrganization = (
  accountId: Account["id"],
  now: number,
): Organization => ({
  id: `org_${crypto.randomUUID()}` as Organization["id"],
  slug: "personal",
  name: "Personal",
  status: "active",
  createdByAccountId: accountId,
  createdAt: now,
  updatedAt: now,
});

const buildOwnerMembership = (
  organizationId: Organization["id"],
  accountId: Account["id"],
  now: number,
): OrganizationMembership => ({
  id: `org_mem_${crypto.randomUUID()}` as OrganizationMembership["id"],
  organizationId,
  accountId,
  role: "owner",
  status: "active",
  billable: true,
  invitedByAccountId: null,
  joinedAt: now,
  createdAt: now,
  updatedAt: now,
});

const buildWorkspace = (
  organizationId: Organization["id"],
  accountId: Account["id"],
  now: number,
): Workspace => ({
  id: `ws_${crypto.randomUUID()}` as Workspace["id"],
  organizationId,
  name: "Default",
  createdByAccountId: accountId,
  createdAt: now,
  updatedAt: now,
});

export const loadLocalInstallation = (
  rows: SqlControlPlaneRows,
): Effect.Effect<LocalInstallation | null, unknown> =>
  rows.localInstallations.getById(LOCAL_INSTALLATION_ID).pipe(
    Effect.map((result) => (Option.isSome(result) ? result.value : null)),
  );

export const provisionLocalInstallation = (
  rows: SqlControlPlaneRows,
): Effect.Effect<LocalInstallation, unknown> =>
  Effect.gen(function* () {
    const existing = yield* rows.localInstallations.getById(LOCAL_INSTALLATION_ID);
    if (Option.isSome(existing)) {
      return existing.value;
    }

    const now = Date.now();
    const account = buildAccount(now);
    const organization = buildOrganization(account.id, now);
    const membership = buildOwnerMembership(organization.id, account.id, now);
    const workspace = buildWorkspace(organization.id, account.id, now);
    const installation: LocalInstallation = {
      id: LOCAL_INSTALLATION_ID,
      accountId: account.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      createdAt: now,
      updatedAt: now,
    };

    yield* rows.accounts.upsert(account);
    yield* rows.organizations.insertWithOwnerMembership(organization, membership);
    yield* rows.workspaces.insert(workspace);
    yield* rows.localInstallations.upsert(installation);

    return installation;
  });

export const getOrProvisionLocalInstallation = (
  rows: SqlControlPlaneRows,
): Effect.Effect<LocalInstallation, unknown> =>
  Effect.flatMap(loadLocalInstallation(rows), (existing) =>
    existing ? Effect.succeed(existing) : provisionLocalInstallation(rows)
  );
