import type { MutationCtx } from "../../convex/_generated/server";
import { upsertWorkosAccount } from "./accounts";
import { getOrganizationByWorkosOrgId } from "./db_queries";
import { getAuthKitUserProfile, resolveIdentityProfile } from "./identity";
import { activateOrganizationMembershipFromInviteHint } from "./memberships";
import { claimAnonymousSessionToWorkosAccount } from "./account_links";
import { getOrCreatePersonalWorkspace, refreshGeneratedPersonalWorkspaceNames } from "./personal_workspace";
import type { AccountId } from "./types";

async function seedHintedOrganizationMembership(
  ctx: MutationCtx,
  args: {
    accountId: AccountId;
    hintedWorkosOrgId?: string;
    email?: string;
    now: number;
  },
) {
  if (!args.hintedWorkosOrgId) {
    return;
  }

  const hintedOrganization = await getOrganizationByWorkosOrgId(ctx, args.hintedWorkosOrgId);
  if (!hintedOrganization) {
    return;
  }

  await activateOrganizationMembershipFromInviteHint(ctx, {
    organizationId: hintedOrganization._id,
    accountId: args.accountId,
    email: args.email,
    now: args.now,
    fallbackRole: "member",
    billable: true,
  });
}

async function hasActiveWorkspaceAccess(ctx: MutationCtx, args: { accountId: AccountId }) {
  const activeOrganizationMembership = await ctx.db
    .query("organizationMembers")
    .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();

  if (!activeOrganizationMembership) {
    return false;
  }

  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_organization_created", (q) => q.eq("organizationId", activeOrganizationMembership.organizationId))
    .first();

  return Boolean(workspace);
}

export async function bootstrapCurrentWorkosAccountImpl(
  ctx: MutationCtx,
  args?: { sessionId?: string },
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const now = Date.now();
  const subject = identity.subject;
  const authKitProfile = await getAuthKitUserProfile(ctx, subject);
  const identityProfile = resolveIdentityProfile({
    identity: { ...identity, subject },
    authKitProfile,
  });

  const account = await upsertWorkosAccount(ctx, {
    workosUserId: subject,
    email: identityProfile.email,
    fullName: identityProfile.fullName,
    firstName: identityProfile.firstName,
    lastName: identityProfile.lastName,
    avatarUrl: identityProfile.avatarUrl,
    now,
    includeLastLoginAt: true,
  });
  if (!account) return null;

  await claimAnonymousSessionToWorkosAccount(ctx, {
    sessionId: args?.sessionId,
    targetAccountId: account._id,
    now,
  });

  await refreshGeneratedPersonalWorkspaceNames(ctx, account._id, {
    email: identityProfile.email,
    firstName: identityProfile.firstName,
    fullName: identityProfile.fullName,
    workosUserId: subject,
    now,
  });

  await seedHintedOrganizationMembership(ctx, {
    accountId: account._id,
    hintedWorkosOrgId: identityProfile.hintedWorkosOrgId,
    email: identityProfile.email,
    now,
  });

  let hasWorkspaceMembership = await hasActiveWorkspaceAccess(ctx, {
    accountId: account._id,
  });

  if (!hasWorkspaceMembership) {
    await getOrCreatePersonalWorkspace(ctx, account._id, {
      email: identityProfile.email,
      firstName: identityProfile.firstName,
      fullName: identityProfile.fullName,
      workosUserId: subject,
      now,
    });

    hasWorkspaceMembership = await hasActiveWorkspaceAccess(ctx, {
      accountId: account._id,
    });

    if (!hasWorkspaceMembership) {
      throw new Error("Account bootstrap did not produce an active workspace access");
    }
  }

  return account;
}
