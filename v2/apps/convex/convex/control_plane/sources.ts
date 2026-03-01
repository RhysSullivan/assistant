import { type UpsertSourcePayload } from "@executor-v2/management-api";
import { SourceSchema, type Source } from "@executor-v2/schema";
import { v } from "convex/values";
import * as Schema from "effect/Schema";

import { internal } from "../_generated/api";
import { action, internalQuery, internalMutation, mutation, query } from "../_generated/server";

const runtimeInternal = internal as any;

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

export const upsertSourceRecord = internalMutation({
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

export const upsertSource = action({
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
    const shouldIngest = args.payload.status !== "draft";
    const source = await ctx.runMutation(runtimeInternal.control_plane.sources.upsertSourceRecord, {
      workspaceId: args.workspaceId,
      payload: {
        ...args.payload,
        status: args.payload.status ?? (shouldIngest ? "probing" : "draft"),
      },
    });

    if (shouldIngest && source.kind !== "internal") {
      await ctx.runAction(runtimeInternal.control_plane.openapi_ingest.ingestSourceArtifact, {
        workspaceId: source.workspaceId,
        sourceId: source.id,
      });
    }

    return source;
  },
});

export const getSourceForIngest = internalQuery({
  args: {
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<Source | null> => {
    const sourceRow = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!sourceRow) {
      return null;
    }

    return toSource(sourceRow as unknown as Record<string, unknown>);
  },
});

export const setSourceIngestState = internalMutation({
  args: {
    sourceId: v.string(),
    status: sourceStatusValidator,
    sourceHash: v.optional(v.union(v.string(), v.null())),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<void> => {
    const sourceRow = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!sourceRow) {
      return;
    }

    await ctx.db.patch(sourceRow._id, {
      status: args.status,
      sourceHash: args.sourceHash !== undefined ? args.sourceHash : sourceRow.sourceHash,
      lastError: args.lastError !== undefined ? args.lastError : sourceRow.lastError,
      updatedAt: Date.now(),
    });
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

    await ctx.runMutation(runtimeInternal.control_plane.tool_registry.removeSourceBindingsAndIndex, {
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
    });

    await ctx.db.delete(existing._id);

    return { removed: true };
  },
});
