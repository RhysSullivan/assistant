import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import {
  createWorkosOrganization,
  ensureWorkosOrganizationMembership,
  revokeWorkosInvitation,
  sendWorkosInvitation,
  updateWorkosOrganizationName,
} from "../../invites/workos";
import { normalizePersonalOrganizationName } from "../../invites/common";

export const deliverWorkosInvite = internalAction({
  args: {
    inviteId: v.id("invites"),
    inviterWorkosUserId: v.string(),
    expiresInDays: v.optional(v.number()),
    roleSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.invites.getInviteDeliveryContext, {
      inviteId: args.inviteId,
    });
    if (!context || context.invite.status !== "pending") {
      return;
    }

    const organizationName = normalizePersonalOrganizationName(context.organization.name);
    let workosOrgId = context.organization.workosOrgId ?? context.workspace?.workosOrgId ?? null;
    let createdWorkosOrganization = false;

    try {
      if (!workosOrgId) {
        const created = await createWorkosOrganization(organizationName);
        workosOrgId = created.id;
        createdWorkosOrganization = true;

        await ctx.runMutation(internal.invites.linkOrganizationToWorkos, {
          organizationId: context.organization._id,
          workspaceId: context.workspace?._id,
          workosOrgId,
        });
      }

      if (!workosOrgId) {
        throw new Error("Failed to resolve WorkOS organization");
      }

      if (createdWorkosOrganization) {
        await ensureWorkosOrganizationMembership({
          workosOrgId,
          workosUserId: args.inviterWorkosUserId,
        });
      }

      await updateWorkosOrganizationName(workosOrgId, organizationName);

      const response = await sendWorkosInvitation({
        email: context.invite.email,
        workosOrgId,
        inviterWorkosUserId: args.inviterWorkosUserId,
        expiresInDays: args.expiresInDays,
        roleSlug: args.roleSlug,
      });

      await ctx.runMutation(internal.invites.markInviteDelivered, {
        inviteId: args.inviteId,
        providerInviteId: response.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown WorkOS invite error";
      await ctx.runMutation(internal.invites.markInviteDeliveryFailed, {
        inviteId: args.inviteId,
        errorMessage: message,
      });
    }
  },
});

export const revokeWorkosInvite = internalAction({
  args: {
    inviteId: v.id("invites"),
    providerInviteId: v.string(),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.runQuery(internal.invites.getInviteById, {
      inviteId: args.inviteId,
    });
    if (!invite || invite.status !== "revoked") {
      return;
    }

    await revokeWorkosInvitation(args.providerInviteId);
  },
});

export const getInviteDeliveryContext = internalQuery({
  args: {
    inviteId: v.id("invites"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      return null;
    }

    const organization = await ctx.db.get(invite.organizationId);
    if (!organization) {
      return null;
    }

    const workspace = invite.workspaceId ? await ctx.db.get(invite.workspaceId) : null;

    return {
      invite,
      organization,
      workspace,
    };
  },
});

export const linkOrganizationToWorkos = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    workspaceId: v.optional(v.id("workspaces")),
    workosOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.patch(args.organizationId, {
      workosOrgId: args.workosOrgId,
      updatedAt: now,
    });

    const workspace = args.workspaceId
      ? await ctx.db.get(args.workspaceId)
      : await ctx.db
          .query("workspaces")
          .withIndex("by_organization_created", (q) => q.eq("organizationId", args.organizationId))
          .first();

    if (!workspace || workspace.organizationId !== args.organizationId) {
      return;
    }

    await ctx.db.patch(workspace._id, {
      workosOrgId: args.workosOrgId,
      updatedAt: now,
    });
  },
});

export const getInviteById = internalQuery({
  args: {
    inviteId: v.id("invites"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.inviteId);
  },
});

export const markInviteDelivered = internalMutation({
  args: {
    inviteId: v.id("invites"),
    providerInviteId: v.string(),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.status !== "pending") {
      return;
    }

    await ctx.db.patch(args.inviteId, {
      providerInviteId: args.providerInviteId,
      updatedAt: Date.now(),
    });
  },
});

export const markInviteDeliveryFailed = internalMutation({
  args: {
    inviteId: v.id("invites"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    void args.errorMessage;
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.status !== "pending") {
      return;
    }

    await ctx.db.patch(args.inviteId, {
      status: "failed",
      updatedAt: Date.now(),
    });
  },
});
