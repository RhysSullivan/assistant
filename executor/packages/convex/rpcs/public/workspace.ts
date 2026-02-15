import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { mutation, query } from "../../_generated/server";
import { workspaceMutation, workspaceQuery } from "../../function_builders";
import type { CredentialRecord } from "../../../core/src/types";

export const bootstrapAnonymousSession = mutation({
  args: {
    sessionId: v.optional(v.string()),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(internal.database.bootstrapAnonymousSession, {
      sessionId: args.sessionId,
      actorId: args.actorId,
    });
  },
});

export const listRuntimeTargets = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.database.listRuntimeTargets, {});
  },
});

export const listCredentialProviders = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.database.listCredentialProviders, {});
  },
});

export const listTasks = workspaceQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.database.listTasks, {
      workspaceId: ctx.workspaceId,
    });
  },
});

export const getTaskInWorkspace = workspaceQuery({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(internal.database.getTaskInWorkspace, {
      taskId: args.taskId,
      workspaceId: ctx.workspaceId,
    });
  },
});

export const listTaskEvents = workspaceQuery({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.runQuery(internal.database.getTaskInWorkspace, {
      taskId: args.taskId,
      workspaceId: ctx.workspaceId,
    });
    if (!task) {
      return [];
    }

    return await ctx.runQuery(internal.database.listTaskEvents, {
      taskId: args.taskId,
    });
  },
});

export const listPendingApprovals = workspaceQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.database.listPendingApprovals, {
      workspaceId: ctx.workspaceId,
    });
  },
});

export const listAccessPolicies = workspaceQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.database.listAccessPolicies, {
      workspaceId: ctx.workspaceId,
    });
  },
});

export const upsertAccessPolicy = workspaceMutation({
  requireAdmin: true,
  args: {
    id: v.optional(v.string()),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    toolPathPattern: v.string(),
    decision: v.union(v.literal("allow"), v.literal("require_approval"), v.literal("deny")),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(internal.database.upsertAccessPolicy, {
      id: args.id,
      workspaceId: ctx.workspaceId,
      actorId: args.actorId,
      clientId: args.clientId,
      toolPathPattern: args.toolPathPattern,
      decision: args.decision,
      priority: args.priority,
    });
  },
});

export const listToolSources = workspaceQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.database.listToolSources, {
      workspaceId: ctx.workspaceId,
    });
  },
});

export const upsertToolSource = workspaceMutation({
  requireAdmin: true,
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    type: v.union(v.literal("mcp"), v.literal("openapi"), v.literal("graphql")),
    config: v.any(),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(internal.database.upsertToolSource, {
      id: args.id,
      workspaceId: ctx.workspaceId,
      name: args.name,
      type: args.type,
      config: args.config,
      enabled: args.enabled,
    });
  },
});

export const deleteToolSource = workspaceMutation({
  requireAdmin: true,
  args: {
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(internal.database.deleteToolSource, {
      workspaceId: ctx.workspaceId,
      sourceId: args.sourceId,
    });
  },
});

export const upsertCredential = workspaceMutation({
  requireAdmin: true,
  args: {
    id: v.optional(v.string()),
    sourceKey: v.string(),
    scope: v.union(v.literal("workspace"), v.literal("actor")),
    actorId: v.optional(v.string()),
    provider: v.optional(v.union(v.literal("local-convex"), v.literal("workos-vault"))),
    secretJson: v.any(),
    overridesJson: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(internal.database.upsertCredential, {
      id: args.id,
      workspaceId: ctx.workspaceId,
      sourceKey: args.sourceKey,
      scope: args.scope,
      actorId: args.actorId,
      provider: args.provider,
      secretJson: args.secretJson,
      overridesJson: args.overridesJson,
    });
  },
});

export const listCredentials = workspaceQuery({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.runQuery(internal.database.listCredentials, {
      workspaceId: ctx.workspaceId,
    }) as CredentialRecord[];

    return credentials.map((credential) => ({
      ...credential,
      secretJson: {},
    }));
  },
});

export const resolveCredential = workspaceQuery({
  requireAdmin: true,
  args: {
    sourceKey: v.string(),
    scope: v.union(v.literal("workspace"), v.literal("actor")),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(internal.database.resolveCredential, {
      workspaceId: ctx.workspaceId,
      sourceKey: args.sourceKey,
      scope: args.scope,
      actorId: args.actorId,
    });
  },
});
