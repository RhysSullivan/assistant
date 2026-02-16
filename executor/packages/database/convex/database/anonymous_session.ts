import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.d.ts";
import { internalMutation } from "../_generated/server";
import { ensureAnonymousIdentity } from "../../src/database/anonymous";
import { mapAnonymousContext } from "../../src/database/readers";

export const bootstrapAnonymousSession = internalMutation({
  args: {
    sessionId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requestedSessionId = args.sessionId?.trim() || "";
    const requestedAccountId = args.accountId?.trim() || "";
    const clientId = args.clientId?.trim() || "web";

    const allowRequestedSessionId = requestedSessionId.startsWith("mcp_")
      || requestedSessionId.startsWith("anon_session_");

    if (requestedSessionId) {
      const sessionId = requestedSessionId;
      const existing = await ctx.db
        .query("anonymousSessions")
        .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
        .unique();
      if (existing) {
        const identity = await ensureAnonymousIdentity(ctx, {
          sessionId,
          workspaceId: existing.workspaceId,
          accountId: requestedAccountId || existing.accountId,
          timestamp: now,
        });

        await ctx.db.patch(existing._id, {
          clientId,
          workspaceId: identity.workspaceId,
          accountId: identity.accountId,
          userId: identity.userId,
          lastSeenAt: now,
        });

        const refreshed = await ctx.db
          .query("anonymousSessions")
          .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
          .unique();
        if (!refreshed) {
          throw new Error("Failed to refresh anonymous session");
        }
        return mapAnonymousContext(refreshed);
      }
    }

    const generatedSessionId = allowRequestedSessionId
      ? (requestedSessionId.startsWith("mcp_") ? `mcp_${crypto.randomUUID()}` : `anon_session_${crypto.randomUUID()}`)
      : `anon_session_${crypto.randomUUID()}`;
    const sessionId = allowRequestedSessionId
      ? requestedSessionId as string
      : generatedSessionId;

    const identity = await ensureAnonymousIdentity(ctx, {
      sessionId,
      accountId: requestedAccountId || undefined,
      timestamp: now,
    });

    await ctx.db.insert("anonymousSessions", {
      sessionId,
      workspaceId: identity.workspaceId,
      clientId,
      accountId: identity.accountId,
      userId: identity.userId,
      createdAt: now,
      lastSeenAt: now,
    });

    const created = await ctx.db
      .query("anonymousSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!created) {
      throw new Error("Failed to create anonymous session");
    }

    return mapAnonymousContext(created);
  },
});

export const ensureAnonymousMcpSession = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    accountId: v.string(),
  },
  handler: async (ctx, args) => {
    const accountId = args.accountId.trim();
    if (!accountId) {
      throw new Error("Anonymous accountId is required");
    }

    const account = await ctx.db.get(accountId as Id<"accounts">);
    if (!account || account.provider !== "anonymous") {
      throw new Error("Anonymous account is not recognized");
    }

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_account", (q) => q.eq("workspaceId", args.workspaceId).eq("accountId", account._id))
      .unique();
    if (!membership || membership.status !== "active") {
      throw new Error("Anonymous account does not have workspace access");
    }

    const now = Date.now();
    const existingSessions = await ctx.db
      .query("anonymousSessions")
      .withIndex("by_workspace_account", (q) => q.eq("workspaceId", args.workspaceId).eq("accountId", account._id))
      .collect();
    const existing = existingSessions.find((session) => session.sessionId.startsWith("mcp_"))
      ?? existingSessions[0]
      ?? null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        accountId: account._id,
        userId: membership._id,
        clientId: "mcp",
        lastSeenAt: now,
      });

      const refreshed = await ctx.db
        .query("anonymousSessions")
        .withIndex("by_session_id", (q) => q.eq("sessionId", existing.sessionId))
        .unique();
      if (!refreshed) {
        throw new Error("Failed to refresh anonymous MCP session");
      }
      return mapAnonymousContext(refreshed);
    }

    const sessionId = `mcp_${crypto.randomUUID()}`;
    await ctx.db.insert("anonymousSessions", {
      sessionId,
      workspaceId: args.workspaceId,
      clientId: "mcp",
      accountId: account._id,
      userId: membership._id,
      createdAt: now,
      lastSeenAt: now,
    });

    const created = await ctx.db
      .query("anonymousSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!created) {
      throw new Error("Failed to create anonymous MCP session");
    }

    return mapAnonymousContext(created);
  },
});
