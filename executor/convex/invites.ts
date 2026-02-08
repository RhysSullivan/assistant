import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getOrganizationMembership } from "./lib/identity";
import { authedMutation, organizationMutation, organizationQuery } from "./lib/functionBuilders";

const workosEnabled = Boolean(process.env.WORKOS_CLIENT_ID && process.env.WORKOS_API_KEY);

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

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
        id: String(invite._id),
        organizationId: String(invite.organizationId),
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
    role: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!workosEnabled) {
      throw new Error("Invites require WorkOS auth to be enabled");
    }

    const now = Date.now();
    const expiresAt = now + (args.expiresInDays ?? 7) * 24 * 60 * 60 * 1000;

    const token = `invite_${crypto.randomUUID()}`;
    const tokenHash = await sha256Hex(token);
    const provider = "workos";

    const inviteId = await ctx.db.insert("invites", {
      organizationId: ctx.organizationId,
      workspaceId: args.workspaceId,
      email: args.email.toLowerCase().trim(),
      role: args.role,
      status: "pending",
      tokenHash,
      provider,
      invitedByAccountId: ctx.account._id,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    const invite = await ctx.db.get(inviteId);
    if (!invite) {
      throw new Error("Failed to create invite");
    }

    return {
      invite: {
        id: String(invite._id),
        organizationId: String(invite.organizationId),
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        token,
      },
      delivery: {
        provider,
        providerInviteId: invite.providerInviteId ?? null,
        state: provider === "workos" ? "queued" : "sent",
      },
    };
  },
});

export const accept = authedMutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);

    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!invite || invite.status !== "pending") {
      throw new Error("Invite is invalid or expired");
    }
    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, {
        status: "expired",
        updatedAt: Date.now(),
      });
      throw new Error("Invite has expired");
    }

    const existing = await getOrganizationMembership(ctx, invite.organizationId, ctx.account._id);
    if (existing) {
      await ctx.db.patch(existing._id, {
        role: invite.role,
        status: "active",
        joinedAt: existing.joinedAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("organizationMembers", {
        organizationId: invite.organizationId,
        accountId: ctx.account._id,
        role: invite.role,
        status: "active",
        billable: true,
        invitedByAccountId: invite.invitedByAccountId,
        joinedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const nextVersion = await ctx.runMutation(internal.billingInternal.bumpSeatSyncVersion, {
      organizationId: invite.organizationId,
    });
    await ctx.scheduler.runAfter(0, internal.billingSync.syncSeatQuantity, {
      organizationId: invite.organizationId,
      expectedVersion: nextVersion,
    });

    return {
      ok: true,
      organizationId: String(invite.organizationId),
    };
  },
});
