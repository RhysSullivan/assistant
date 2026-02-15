import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { organizationMutation, organizationQuery } from "../../function_builders";
import { mapRoleToWorkosRoleSlug, workosEnabled } from "../../invites/workos";
import { normalizePersonalOrganizationName, organizationRoleValidator } from "../../invites/common";

export const list = organizationQuery({
  requireAdmin: true,
  args: {},
  handler: async (ctx) => {
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_org", (q) => q.eq("organizationId", ctx.organizationId))
      .order("desc")
      .take(200);

    return {
      items: invites.map((invite) => ({
        id: invite._id,
        organizationId: invite.organizationId,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
      })),
    };
  },
});

export const create = organizationMutation({
  requireAdmin: true,
  args: {
    email: v.string(),
    role: organizationRoleValidator,
    workspaceId: v.optional(v.id("workspaces")),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!workosEnabled) {
      throw new Error("Invites require WorkOS auth to be enabled");
    }

    const now = Date.now();
    const organization = await ctx.db.get(ctx.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    const normalizedOrganizationName = normalizePersonalOrganizationName(organization.name);
    if (normalizedOrganizationName !== organization.name) {
      await ctx.db.patch(ctx.organizationId, {
        name: normalizedOrganizationName,
        updatedAt: now,
      });
    }

    const expiresAt = now + (args.expiresInDays ?? 7) * 24 * 60 * 60 * 1000;
    const normalizedEmail = args.email.toLowerCase().trim();

    if (args.workspaceId) {
      const workspace = await ctx.db.get(args.workspaceId);
      if (workspace?.organizationId !== ctx.organizationId) {
        throw new Error("Workspace does not belong to this organization");
      }
    }

    if (ctx.account.provider !== "workos") {
      throw new Error("Inviter is not linked to WorkOS");
    }
    const inviterWorkosUserId = ctx.account.providerAccountId;

    const inviteId = await ctx.db.insert("invites", {
      organizationId: ctx.organizationId,
      workspaceId: args.workspaceId,
      email: normalizedEmail,
      role: args.role,
      status: "pending",
      invitedByAccountId: ctx.account._id,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.invites.deliverWorkosInvite, {
      inviteId,
      inviterWorkosUserId,
      expiresInDays: args.expiresInDays,
      roleSlug: mapRoleToWorkosRoleSlug(args.role),
    });

    const invite = await ctx.db.get(inviteId);
    if (!invite) {
      throw new Error("Failed to create invite");
    }

    return {
      invite: {
        id: invite._id,
        organizationId: invite.organizationId,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
      },
      delivery: {
        providerInviteId: invite.providerInviteId ?? null,
        state: "queued",
      },
    };
  },
});

export const revoke = organizationMutation({
  requireAdmin: true,
  args: {
    inviteId: v.id("invites"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.organizationId !== ctx.organizationId) {
      throw new Error("Invite not found");
    }

    if (invite.status !== "pending" && invite.status !== "failed") {
      throw new Error("Only pending invites can be removed");
    }

    await ctx.db.patch(args.inviteId, {
      status: "revoked",
      updatedAt: Date.now(),
    });

    if (invite.providerInviteId) {
      await ctx.scheduler.runAfter(0, internal.invites.revokeWorkosInvite, {
        inviteId: invite._id,
        providerInviteId: invite.providerInviteId,
      });
    }

    return { ok: true };
  },
});
