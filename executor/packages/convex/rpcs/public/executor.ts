import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import { workspaceMutation } from "../../function_builders";
import { actorIdForAccount } from "../../../core/src/identity";
import type { ApprovalRecord, TaskExecutionOutcome, TaskRecord } from "../../../core/src/types";
import { resolveApprovalRecord } from "../../executor_impl";

export const createTask = action({
  args: {
    code: v.string(),
    timeoutMs: v.optional(v.number()),
    runtimeId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    workspaceId: v.id("workspaces"),
    sessionId: v.optional(v.string()),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    waitForResult: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<TaskExecutionOutcome> => {
    const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForRequest, {
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
    });

    const canonicalActorId = actorIdForAccount({
      _id: access.accountId,
      provider: access.provider,
      providerAccountId: access.providerAccountId,
    });

    if (args.actorId && args.actorId !== canonicalActorId) {
      throw new Error("actorId must match the authenticated workspace actor");
    }

    const waitForResult = args.waitForResult ?? false;
    // Use the internal mutation so task scheduling runs in a mutation context
    // (convex-test does not support scheduler writes directly from actions).
    const created = await ctx.runMutation(internal.executor.createTaskInternal, {
      code: args.code,
      timeoutMs: args.timeoutMs,
      runtimeId: args.runtimeId,
      metadata: args.metadata,
      workspaceId: args.workspaceId,
      actorId: canonicalActorId,
      clientId: args.clientId,
      scheduleAfterCreate: !waitForResult,
    });

    if (!waitForResult) {
      return { task: created.task as TaskRecord };
    }

    const runOutcome = await ctx.runAction(internal.executorNode.runTask, {
      taskId: created.task.id,
    });

    if (runOutcome?.task) {
      return runOutcome;
    }

    const task = await ctx.runQuery(internal.database.getTaskInWorkspace, {
      taskId: created.task.id,
      workspaceId: args.workspaceId,
    });

    if (!task) {
      throw new Error(`Task ${created.task.id} not found after execution`);
    }

    return { task };
  },
});

export const resolveApproval = workspaceMutation({
  args: {
    approvalId: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    reviewerId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ approval: ApprovalRecord; task: TaskRecord } | null> => {
    const canonicalActorId = actorIdForAccount(ctx.account as { _id: string; provider: string; providerAccountId: string });
    if (args.reviewerId && args.reviewerId !== canonicalActorId) {
      throw new Error("reviewerId must match the authenticated workspace actor");
    }

    return await resolveApprovalRecord(ctx, {
      ...args,
      workspaceId: ctx.workspaceId,
      reviewerId: canonicalActorId,
    });
  },
});
