import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel.d.ts";

function readLegacyDtsStorageIds(entry: unknown): Id<"_storage">[] {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  const raw = Reflect.get(entry, "dtsStorageIds");
  if (!Array.isArray(raw)) {
    return [];
  }

  const ids: Id<"_storage">[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const storageId = Reflect.get(item, "storageId");
    if (typeof storageId === "string" && storageId.length > 0) {
      ids.push(storageId as Id<"_storage">);
    }
  }

  return ids;
}

/**
 * Look up a cached workspace tool snapshot by workspace ID.
 * Returns the storageId if the signature matches (sources haven't changed).
 */
export const getEntry = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("workspaceToolCache")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();

    if (!entry) return null;

    return {
      isFresh: entry.signature === args.signature,
      storageId: entry.storageId,
      typesStorageId: entry.typesStorageId,
      toolCount: entry.toolCount,
      sizeBytes: entry.sizeBytes,
      createdAt: entry.createdAt,
    };
  },
});

/**
 * Write (or replace) a workspace tool cache entry.
 * Deletes old blobs (main snapshot + .d.ts blobs) if replacing.
 */
export const putEntry = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    signature: v.string(),
    storageId: v.id("_storage"),
    typesStorageId: v.optional(v.id("_storage")),
    toolCount: v.number(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceToolCache")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();

    if (existing) {
      // Delete old main snapshot blob
      await ctx.storage.delete(existing.storageId).catch(() => {});
      for (const legacyStorageId of readLegacyDtsStorageIds(existing)) {
        await ctx.storage.delete(legacyStorageId).catch(() => {});
      }
      if (existing.typesStorageId) {
        await ctx.storage.delete(existing.typesStorageId).catch(() => {});
      }
      await ctx.db.delete(existing._id);
    }

    await ctx.db.insert("workspaceToolCache", {
      workspaceId: args.workspaceId,
      signature: args.signature,
      storageId: args.storageId,
      typesStorageId: args.typesStorageId,
      toolCount: args.toolCount,
      sizeBytes: args.sizeBytes,
      createdAt: Date.now(),
    });
  },
});
