import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ensureAnonymousIdentity } from "./database-anonymous";
import { mapAnonymousContext } from "./database-readers";

export const bootstrapAnonymousSession = internalMutation({
  args: { sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requestedSessionId = args.sessionId?.trim() || "";
    const allowRequestedSessionId = requestedSessionId?.startsWith("mcp_") ?? false;

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
          actorId: existing.actorId,
          timestamp: now,
        });

        await ctx.db.patch(existing._id, {
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
      ? `mcp_${crypto.randomUUID()}`
      : `anon_session_${crypto.randomUUID()}`;
    const sessionId = allowRequestedSessionId
      ? requestedSessionId as string
      : generatedSessionId;
    const actorId = `anon_${crypto.randomUUID()}`;
    const clientId = "web";

    const identity = await ensureAnonymousIdentity(ctx, {
      sessionId,
      actorId,
      timestamp: now,
    });

    await ctx.db.insert("anonymousSessions", {
      sessionId,
      workspaceId: identity.workspaceId,
      actorId,
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
