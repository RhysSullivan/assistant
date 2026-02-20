import type { Id } from "../../convex/_generated/dataModel.d.ts";
import type { MutationCtx } from "../../convex/_generated/server";
import type { OrganizationRole } from "./types";
import { upsertOrganizationMembership } from "./memberships";

const rolePriority: Record<OrganizationRole, number> = {
  owner: 400,
  admin: 300,
  billing_admin: 200,
  member: 100,
};

function higherRole(left: OrganizationRole, right: OrganizationRole): OrganizationRole {
  return rolePriority[left] >= rolePriority[right] ? left : right;
}

async function upsertAccountLink(
  ctx: Pick<MutationCtx, "db">,
  args: {
    sourceAccountId: Id<"accounts">;
    targetAccountId: Id<"accounts">;
    sourceProvider: "workos" | "anonymous";
    targetProvider: "workos" | "anonymous";
    now: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("accountLinks")
    .withIndex("by_source_target", (q) => q.eq("sourceAccountId", args.sourceAccountId).eq("targetAccountId", args.targetAccountId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      sourceProvider: args.sourceProvider,
      targetProvider: args.targetProvider,
      linkReason: "anonymous_claim",
      updatedAt: args.now,
    });
    return;
  }

  await ctx.db.insert("accountLinks", {
    sourceAccountId: args.sourceAccountId,
    targetAccountId: args.targetAccountId,
    sourceProvider: args.sourceProvider,
    targetProvider: args.targetProvider,
    linkReason: "anonymous_claim",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export async function claimAnonymousSessionToWorkosAccount(
  ctx: MutationCtx,
  args: {
    sessionId?: string;
    targetAccountId: Id<"accounts">;
    now: number;
  },
): Promise<{
  linked: boolean;
  sourceAccountId?: Id<"accounts">;
  migratedOrganizationCount: number;
  migratedSessionCount: number;
}> {
  const normalizedSessionId = args.sessionId?.trim() ?? "";
  if (!normalizedSessionId.startsWith("anon_session_") && !normalizedSessionId.startsWith("mcp_")) {
    return {
      linked: false,
      migratedOrganizationCount: 0,
      migratedSessionCount: 0,
    };
  }

  const session = await ctx.db
    .query("anonymousSessions")
    .withIndex("by_session_id", (q) => q.eq("sessionId", normalizedSessionId))
    .unique();
  if (!session) {
    return {
      linked: false,
      migratedOrganizationCount: 0,
      migratedSessionCount: 0,
    };
  }

  const sourceAccount = await ctx.db.get(session.accountId);
  const targetAccount = await ctx.db.get(args.targetAccountId);
  if (!sourceAccount || !targetAccount) {
    return {
      linked: false,
      migratedOrganizationCount: 0,
      migratedSessionCount: 0,
    };
  }

  if (sourceAccount._id === targetAccount._id) {
    return {
      linked: false,
      migratedOrganizationCount: 0,
      migratedSessionCount: 0,
    };
  }

  if (sourceAccount.provider !== "anonymous" || targetAccount.provider !== "workos") {
    throw new Error("Account linking currently supports anonymous -> workos only");
  }

  await upsertAccountLink(ctx, {
    sourceAccountId: sourceAccount._id,
    targetAccountId: targetAccount._id,
    sourceProvider: sourceAccount.provider,
    targetProvider: targetAccount.provider,
    now: args.now,
  });

  const memberships = await ctx.db
    .query("organizationMembers")
    .withIndex("by_account", (q) => q.eq("accountId", sourceAccount._id))
    .collect();

  const migratedOrganizationIds = new Set<Id<"organizations">>();
  for (const membership of memberships) {
    if (membership.status !== "active") {
      continue;
    }

    const targetMembership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_account", (q) => q.eq("organizationId", membership.organizationId).eq("accountId", targetAccount._id))
      .unique();

    const mergedRole = targetMembership
      ? higherRole(membership.role, targetMembership.role)
      : membership.role;

    await upsertOrganizationMembership(ctx, {
      organizationId: membership.organizationId,
      accountId: targetAccount._id,
      role: mergedRole,
      status: "active",
      billable: membership.billable || targetMembership?.billable === true,
      invitedByAccountId: membership.invitedByAccountId,
      now: args.now,
    });

    migratedOrganizationIds.add(membership.organizationId);
  }

  const ownedOrganizations = await ctx.db
    .query("organizations")
    .withIndex("by_creator_created", (q) => q.eq("createdByAccountId", sourceAccount._id))
    .collect();

  for (const organization of ownedOrganizations) {
    if (organization.createdByAccountId === sourceAccount._id) {
      await ctx.db.patch(organization._id, {
        createdByAccountId: targetAccount._id,
        updatedAt: args.now,
      });
      migratedOrganizationIds.add(organization._id);
    }
  }

  for (const organizationId of migratedOrganizationIds) {
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId))
      .collect();
    for (const workspace of workspaces) {
      if (workspace.createdByAccountId === sourceAccount._id) {
        await ctx.db.patch(workspace._id, {
          createdByAccountId: targetAccount._id,
          updatedAt: args.now,
        });
      }
    }
  }

  const sourceSessions = await ctx.db
    .query("anonymousSessions")
    .withIndex("by_account", (q) => q.eq("accountId", sourceAccount._id))
    .collect();
  for (const sourceSession of sourceSessions) {
    await ctx.db.patch(sourceSession._id, {
      accountId: targetAccount._id,
      lastSeenAt: args.now,
    });
  }

  return {
    linked: true,
    sourceAccountId: sourceAccount._id,
    migratedOrganizationCount: migratedOrganizationIds.size,
    migratedSessionCount: sourceSessions.length,
  };
}
