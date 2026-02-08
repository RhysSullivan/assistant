import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit";
import { getManyFrom, getOneFrom } from "convex-helpers/server/relationships";
import { components, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { ensureUniqueSlug } from "./lib/slug";

type DbCtx = Pick<MutationCtx, "db">;
type RunQueryCtx = Pick<MutationCtx, "runQuery">;
type WorkosEventCtx = Pick<MutationCtx, "db" | "runQuery">;
type OrganizationRole = "owner" | "admin" | "member" | "billing_admin";
type OrganizationMemberStatus = "active" | "pending" | "removed";

const workosEnabled = Boolean(
  process.env.WORKOS_CLIENT_ID && process.env.WORKOS_API_KEY && process.env.WORKOS_WEBHOOK_SECRET,
);

const authFunctions: AuthFunctions = internal.auth;

const authKitInstance = workosEnabled
  ? new AuthKit<DataModel>(components.workOSAuthKit, {
      authFunctions,
      additionalEventTypes: [
        "organization.created",
        "organization.updated",
        "organization.deleted",
        "organization_membership.created",
        "organization_membership.updated",
        "organization_membership.deleted",
      ],
    })
  : null;

export const authKit =
  authKitInstance ??
  ({
    registerRoutes: () => {},
  } as Pick<AuthKit<DataModel>, "registerRoutes">);

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "workspace";
}

async function getAccountByWorkosId(ctx: DbCtx, workosUserId: string) {
  return await ctx.db
    .query("accounts")
    .withIndex("by_provider", (q) => q.eq("provider", "workos").eq("providerAccountId", workosUserId))
    .unique();
}

async function getOrganizationByWorkosOrgId(ctx: DbCtx, workosOrgId: string) {
  return await getOneFrom(ctx.db, "organizations", "by_workos_org_id", workosOrgId, "workosOrgId");
}

async function resolveOrganizationIdByWorkosOrgId(ctx: DbCtx, workosOrgId: string): Promise<Id<"organizations"> | null> {
  const organization = await getOrganizationByWorkosOrgId(ctx, workosOrgId);
  return organization?._id ?? null;
}

async function getPrimaryWorkspaceByOrganizationId(ctx: DbCtx, organizationId: Id<"organizations">) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId))
    .order("asc")
    .first();
}

function mapWorkosRoleToOrganizationRole(roleSlug: string | undefined): OrganizationRole {
  if (roleSlug === "owner") {
    return "owner";
  }
  if (roleSlug === "admin") {
    return "admin";
  }
  if (roleSlug === "billing_admin") {
    return "billing_admin";
  }
  return "member";
}

async function ensureUniqueOrganizationSlug(ctx: DbCtx, baseName: string): Promise<string> {
  const baseSlug = slugify(baseName);
  return await ensureUniqueSlug(baseSlug, async (candidate) => {
    const collision = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .unique();
    return collision !== null;
  });
}

async function upsertOrganizationMembership(
  ctx: DbCtx,
  args: {
    organizationId: Id<"organizations">;
    accountId: Id<"accounts">;
    workosOrgMembershipId?: string;
    role: OrganizationRole;
    status: OrganizationMemberStatus;
    billable: boolean;
    invitedByAccountId?: Id<"accounts">;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("organizationMembers")
    .withIndex("by_org_account", (q) => q.eq("organizationId", args.organizationId).eq("accountId", args.accountId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      workosOrgMembershipId: args.workosOrgMembershipId ?? existing.workosOrgMembershipId,
      role: args.role,
      status: args.status,
      billable: args.billable,
      invitedByAccountId: args.invitedByAccountId,
      joinedAt: args.status === "active" ? (existing.joinedAt ?? args.now) : existing.joinedAt,
      updatedAt: args.now,
    });
    return;
  }

  await ctx.db.insert("organizationMembers", {
    organizationId: args.organizationId,
    accountId: args.accountId,
    workosOrgMembershipId: args.workosOrgMembershipId,
    role: args.role,
    status: args.status,
    billable: args.billable,
    invitedByAccountId: args.invitedByAccountId,
    joinedAt: args.status === "active" ? args.now : undefined,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function markPendingInvitesAcceptedByEmail(
  ctx: DbCtx,
  args: {
    organizationId: Id<"organizations">;
    email?: string;
    acceptedAt: number;
  },
) {
  if (!args.email) {
    return;
  }

  const normalizedEmail = args.email.toLowerCase();
  const pendingInvites = await ctx.db
    .query("invites")
    .withIndex("by_org_email_status", (q) =>
      q.eq("organizationId", args.organizationId).eq("email", normalizedEmail).eq("status", "pending"),
    )
    .collect();

  for (const invite of pendingInvites) {
    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: args.acceptedAt,
      updatedAt: args.acceptedAt,
    });
  }
}

async function ensurePersonalWorkspace(
  ctx: DbCtx,
  accountId: Id<"accounts">,
  opts: { email: string; firstName?: string; workosUserId: string; now: number; workspaceName?: string },
) {
  const personalWorkspace = await ctx.db
    .query("workspaces")
    .withIndex("by_creator_created", (q) => q.eq("createdByAccountId", accountId))
    .order("asc")
    .first();

  if (personalWorkspace) {
    await upsertOrganizationMembership(ctx, {
      organizationId: personalWorkspace.organizationId,
      accountId,
      role: "owner",
      status: "active",
      billable: true,
      now: opts.now,
    });
    return { workspace: await ctx.db.get(personalWorkspace._id) };
  }

  const workspaceName = opts.workspaceName ?? `${opts.firstName ?? "My"}'s Workspace`;
  const organizationSlug = await ensureUniqueOrganizationSlug(ctx, workspaceName);
  const organizationId = await ctx.db.insert("organizations", {
    slug: organizationSlug,
    name: workspaceName,
    status: "active",
    createdByAccountId: accountId,
    createdAt: opts.now,
    updatedAt: opts.now,
  });

  const baseSlug = slugify(opts.email.split("@")[0] ?? opts.workosUserId);
  const workspaceId = await ctx.db.insert("workspaces", {
    organizationId,
    slug: `${baseSlug}-${opts.workosUserId.slice(-6)}`,
    name: workspaceName,
    createdByAccountId: accountId,
    createdAt: opts.now,
    updatedAt: opts.now,
  });

  await upsertOrganizationMembership(ctx, {
    organizationId,
    accountId,
    role: "owner",
    status: "active",
    billable: true,
    now: opts.now,
  });

  return {
    workspace: await ctx.db.get(workspaceId),
  };
}

function getIdentityString(identity: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = identity[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

async function getAuthKitUserProfile(ctx: RunQueryCtx, workosUserId: string) {
  try {
    return await ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, {
      id: workosUserId,
    });
  } catch {
    return null;
  }
}

const workosEventHandlers = {
  "user.created": async (ctx, event) => {
    const now = Date.now();
    const data = event.data;
    const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ") || data.email;

    let account = await getAccountByWorkosId(ctx, data.id);
    if (account) {
      await ctx.db.patch(account._id, {
        email: data.email,
        name: fullName,
        firstName: data.firstName ?? undefined,
        lastName: data.lastName ?? undefined,
        avatarUrl: data.profilePictureUrl ?? undefined,
        status: "active",
        updatedAt: now,
        lastLoginAt: now,
      });
      account = await ctx.db.get(account._id);
    } else {
      const accountId = await ctx.db.insert("accounts", {
        provider: "workos",
        providerAccountId: data.id,
        email: data.email,
        name: fullName,
        firstName: data.firstName ?? undefined,
        lastName: data.lastName ?? undefined,
        avatarUrl: data.profilePictureUrl ?? undefined,
        status: "active",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
      account = await ctx.db.get(accountId);
    }

    if (!account) return;
    await ensurePersonalWorkspace(ctx, account._id, {
      email: data.email,
      firstName: data.firstName ?? undefined,
      workosUserId: data.id,
      now,
    });
  },

  "user.updated": async (ctx, event) => {
    const account = await getAccountByWorkosId(ctx, event.data.id);
    if (!account) return;

    const fullName = [event.data.firstName, event.data.lastName].filter(Boolean).join(" ") || event.data.email;
    await ctx.db.patch(account._id, {
      email: event.data.email,
      name: fullName,
      firstName: event.data.firstName ?? undefined,
      lastName: event.data.lastName ?? undefined,
      avatarUrl: event.data.profilePictureUrl ?? undefined,
      status: "active",
      updatedAt: Date.now(),
    });
  },

  "user.deleted": async (ctx, event) => {
    const account = await getAccountByWorkosId(ctx, event.data.id);
    if (!account) return;

    const memberships = await getManyFrom(ctx.db, "organizationMembers", "by_account", account._id, "accountId");
    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }

    await ctx.db.delete(account._id);
  },

  "organization.created": async (ctx, event) => {
    const now = Date.now();
    let organization = await getOrganizationByWorkosOrgId(ctx, event.data.id);
    if (organization) {
      await ctx.db.patch(organization._id, {
        name: event.data.name,
        status: "active",
        updatedAt: now,
      });
      organization = await ctx.db.get(organization._id);
    } else {
      const slug = await ensureUniqueOrganizationSlug(ctx, event.data.name);
      const organizationId = await ctx.db.insert("organizations", {
        workosOrgId: event.data.id,
        slug,
        name: event.data.name,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      organization = await ctx.db.get(organizationId);
    }

    if (!organization) {
      return;
    }

    const existingWorkspace = await getPrimaryWorkspaceByOrganizationId(ctx, organization._id);
    if (existingWorkspace) {
      await ctx.db.patch(existingWorkspace._id, {
        name: event.data.name,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("workspaces", {
      organizationId: organization._id,
      slug: `${slugify(event.data.name)}-${event.data.id.slice(-6)}`,
      name: event.data.name,
      createdAt: now,
      updatedAt: now,
    });
  },

  "organization.updated": async (ctx, event) => {
    const organization = await getOrganizationByWorkosOrgId(ctx, event.data.id);
    if (!organization) return;

    const now = Date.now();

    await ctx.db.patch(organization._id, {
      name: event.data.name,
      updatedAt: now,
    });

    const workspace = await getPrimaryWorkspaceByOrganizationId(ctx, organization._id);
    if (!workspace) return;

    await ctx.db.patch(workspace._id, {
      name: event.data.name,
      updatedAt: now,
    });
  },

  "organization.deleted": async (ctx, event) => {
    const organization = await getOrganizationByWorkosOrgId(ctx, event.data.id);
    if (organization) {
      await ctx.db.patch(organization._id, {
        status: "deleted",
        updatedAt: Date.now(),
      });
    }

    if (!organization) {
      return;
    }

    const workspaces = await getManyFrom(
      ctx.db,
      "workspaces",
      "by_organization_created",
      organization._id,
      "organizationId",
    );

    for (const workspace of workspaces) {
      await ctx.db.delete(workspace._id);
    }
  },

  "organization_membership.created": async (ctx, event) => {
    const now = Date.now();
    const data = event.data as {
      id: string;
      user_id?: string;
      userId?: string;
      organization_id?: string;
      organizationId?: string;
      role?: { slug?: string };
      status?: string;
    };
    const workosUserId = data.user_id ?? data.userId;
    const workosOrgId = data.organization_id ?? data.organizationId;
    if (!workosUserId || !workosOrgId) return;

    const [account, organizationId] = await Promise.all([
      getAccountByWorkosId(ctx, workosUserId),
      resolveOrganizationIdByWorkosOrgId(ctx, workosOrgId),
    ]);
    if (!account || !organizationId) return;

    const role = mapWorkosRoleToOrganizationRole(data.role?.slug);
    const status = data.status === "active" ? "active" : "pending";

    await upsertOrganizationMembership(ctx, {
      organizationId,
      accountId: account._id,
      workosOrgMembershipId: data.id,
      role,
      status,
      billable: status === "active",
      now,
    });

    if (status === "active") {
      await markPendingInvitesAcceptedByEmail(ctx, {
        organizationId,
        email: account.email,
        acceptedAt: now,
      });
    }
  },

  "organization_membership.updated": async (ctx, event) => {
    const now = Date.now();
    const data = event.data as {
      id: string;
      user_id?: string;
      userId?: string;
      organization_id?: string;
      organizationId?: string;
      role?: { slug?: string };
      status?: string;
    };

    let membership = await getOneFrom(
      ctx.db,
      "organizationMembers",
      "by_workos_membership_id",
      data.id,
      "workosOrgMembershipId",
    );

    let accountId: Id<"accounts"> | null = membership?.accountId ?? null;
    let organizationId: Id<"organizations"> | null = membership?.organizationId ?? null;
    let account = accountId ? await ctx.db.get(accountId) : null;

    if (!account || !organizationId) {
      const workosUserId = data.user_id ?? data.userId;
      const workosOrgId = data.organization_id ?? data.organizationId;
      if (!workosUserId || !workosOrgId) return;

      const [resolvedAccount, resolvedOrganizationId] = await Promise.all([
        getAccountByWorkosId(ctx, workosUserId),
        resolveOrganizationIdByWorkosOrgId(ctx, workosOrgId),
      ]);

      account = resolvedAccount;
      accountId = resolvedAccount?._id ?? null;
      organizationId = resolvedOrganizationId;

      if (!accountId || !organizationId) {
        return;
      }

      const accountIdForLookup: Id<"accounts"> = accountId;
      const organizationIdForLookup: Id<"organizations"> = organizationId;

      membership = await ctx.db
        .query("organizationMembers")
        .withIndex("by_org_account", (q) =>
          q.eq("organizationId", organizationIdForLookup).eq("accountId", accountIdForLookup),
        )
        .unique();
    }

    if (!account || !accountId || !organizationId) {
      return;
    }

    const role = mapWorkosRoleToOrganizationRole(data.role?.slug);
    const status = data.status === "active" ? "active" : "pending";

    await upsertOrganizationMembership(ctx, {
      organizationId,
      accountId,
      workosOrgMembershipId: data.id,
      role,
      status,
      billable: status === "active",
      now,
    });

    if (status === "active") {
      await markPendingInvitesAcceptedByEmail(ctx, {
        organizationId,
        email: account.email,
        acceptedAt: now,
      });
    }
  },

  "organization_membership.deleted": async (ctx, event) => {
    const now = Date.now();
    const data = event.data as {
      id: string;
      user_id?: string;
      userId?: string;
      organization_id?: string;
      organizationId?: string;
    };

    let membership = await getOneFrom(
      ctx.db,
      "organizationMembers",
      "by_workos_membership_id",
      data.id,
      "workosOrgMembershipId",
    );

    if (!membership) {
      const workosUserId = data.user_id ?? data.userId;
      const workosOrgId = data.organization_id ?? data.organizationId;
      if (!workosUserId || !workosOrgId) {
        return;
      }

      const [account, organizationId] = await Promise.all([
        getAccountByWorkosId(ctx, workosUserId),
        resolveOrganizationIdByWorkosOrgId(ctx, workosOrgId),
      ]);
      if (!account || !organizationId) {
        return;
      }

      membership = await ctx.db
        .query("organizationMembers")
        .withIndex("by_org_account", (q) => q.eq("organizationId", organizationId).eq("accountId", account._id))
        .unique();
      if (!membership) {
        return;
      }
    }

    await upsertOrganizationMembership(ctx, {
      organizationId: membership.organizationId,
      accountId: membership.accountId,
      workosOrgMembershipId: data.id,
      role: membership.role,
      status: "removed",
      billable: false,
      now,
    });
  },
} satisfies Partial<Parameters<AuthKit<DataModel>["events"]>[0]>;

const authKitEvents = workosEnabled && authKitInstance
  ? authKitInstance.events(workosEventHandlers)
  : null;

export const authKitEvent = authKitEvents?.authKitEvent ?? internalMutation({
  args: {},
  handler: async () => null,
});

export const bootstrapCurrentWorkosAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const now = Date.now();
    const identityRecord = identity as Record<string, unknown>;
    const subject = identity.subject;
    const authKitProfile = await getAuthKitUserProfile(ctx, subject);
    const email =
      authKitProfile?.email
      ??
      getIdentityString(identityRecord, [
        "email",
        "https://workos.com/email",
        "upn",
      ]) ?? `${subject}@workos.executor.local`;

    const firstName =
      authKitProfile?.firstName
      ?? getIdentityString(identityRecord, [
        "given_name",
        "first_name",
        "https://workos.com/first_name",
      ]);
    const lastName =
      authKitProfile?.lastName
      ?? getIdentityString(identityRecord, [
        "family_name",
        "last_name",
        "https://workos.com/last_name",
      ]);
    const fullName =
      (getIdentityString(identityRecord, [
        "name",
        "https://workos.com/name",
      ]) ?? [firstName, lastName].filter(Boolean).join(" "))
      || email;
    const avatarUrl =
      (authKitProfile?.profilePictureUrl ?? undefined)
      ?? getIdentityString(identityRecord, [
        "picture",
        "avatar_url",
        "https://workos.com/profile_picture_url",
      ]);

    let account = await getAccountByWorkosId(ctx, subject);

    if (account) {
      await ctx.db.patch(account._id, {
        email,
        name: fullName,
        firstName,
        lastName,
        avatarUrl,
        status: "active",
        updatedAt: now,
        lastLoginAt: now,
      });
      account = await ctx.db.get(account._id);
    } else {
      const accountId = await ctx.db.insert("accounts", {
        provider: "workos",
        providerAccountId: subject,
        email,
        name: fullName,
        firstName,
        lastName,
        avatarUrl,
        status: "active",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
      account = await ctx.db.get(accountId);
    }

    if (!account) return null;

    await ensurePersonalWorkspace(ctx, account._id, {
      email,
      firstName,
      workosUserId: subject,
      now,
      workspaceName: `${firstName ?? "My"}'s Workspace`,
    });

    return account;
  },
});
