import { type UpsertSourcePayload } from "@executor-v2/control-plane";
import { SourceSchema, type Source } from "@executor-v2/schema";
import { v } from "convex/values";
import * as Schema from "effect/Schema";

import { mutation, query } from "../_generated/server";

const decodeSource = Schema.decodeUnknownSync(SourceSchema);

const sourceStoreKey = (source: Source): string => `${source.workspaceId}:${source.id}`;

const sortSources = (sources: ReadonlyArray<Source>): Array<Source> =>
  [...sources].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName === rightName) {
      return sourceStoreKey(left).localeCompare(sourceStoreKey(right));
    }

    return leftName.localeCompare(rightName);
  });

const toSource = (document: Record<string, unknown>): Source => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...source } = document;
  return decodeSource(source);
};

const sourceKindValidator = v.union(
  v.literal("mcp"),
  v.literal("openapi"),
  v.literal("graphql"),
  v.literal("internal"),
);

const sourceStatusValidator = v.union(
  v.literal("draft"),
  v.literal("probing"),
  v.literal("auth_required"),
  v.literal("connected"),
  v.literal("error"),
);

export const listSources = query({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<Source>> => {
    const documents = await ctx.db
      .query("sources")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return sortSources(
      documents.map((document) =>
        toSource(document as unknown as Record<string, unknown>),
      ),
    );
  },
});

export const upsertSource = mutation({
  args: {
    workspaceId: v.string(),
    payload: v.object({
      id: v.optional(v.string()),
      name: v.string(),
      kind: sourceKindValidator,
      endpoint: v.string(),
      status: v.optional(sourceStatusValidator),
      enabled: v.optional(v.boolean()),
      configJson: v.optional(v.string()),
      sourceHash: v.optional(v.union(v.string(), v.null())),
      lastError: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, args): Promise<Source> => {
    const now = Date.now();
    const sourceId = args.payload.id ?? `src_${crypto.randomUUID()}`;

    const existing = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", sourceId))
      .unique();

    const existingInWorkspace =
      existing && existing.workspaceId === args.workspaceId ? existing : null;

    const payload = args.payload as UpsertSourcePayload;

    const source = decodeSource({
      id: sourceId,
      workspaceId: args.workspaceId,
      name: payload.name,
      kind: payload.kind,
      endpoint: payload.endpoint,
      status: payload.status ?? "draft",
      enabled: payload.enabled ?? true,
      configJson: payload.configJson ?? "{}",
      sourceHash: payload.sourceHash ?? null,
      lastError: payload.lastError ?? null,
      createdAt: existingInWorkspace?.createdAt ?? now,
      updatedAt: now,
    });

    if (existingInWorkspace) {
      await ctx.db.patch(existingInWorkspace._id, source);
    } else {
      await ctx.db.insert("sources", source);
    }

    return source;
  },
});

export const removeSource = mutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    removed: boolean;
  }> => {
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!existing || existing.workspaceId !== args.workspaceId) {
      return { removed: false };
    }

    await ctx.db.delete(existing._id);

    return { removed: true };
  },
});
