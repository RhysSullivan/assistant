import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { ApprovalRecord, TaskRecord } from "../../../core/src/types";
import {
  completeRuntimeRunArgsValidator,
  completeRuntimeRunImpl,
  createTaskRecord,
  resolveApprovalRecord,
} from "../../executor_impl";

export const createTaskInternal = internalMutation({
  args: {
    code: v.string(),
    timeoutMs: v.optional(v.number()),
    runtimeId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    workspaceId: v.id("workspaces"),
    actorId: v.string(),
    clientId: v.optional(v.string()),
    scheduleAfterCreate: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ task: TaskRecord }> => {
    return await createTaskRecord(ctx, args);
  },
});

export const resolveApprovalInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    approvalId: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    reviewerId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ approval: ApprovalRecord; task: TaskRecord } | null> => {
    return await resolveApprovalRecord(ctx, args);
  },
});

export const completeRuntimeRun = internalMutation({
  args: completeRuntimeRunArgsValidator,
  handler: async (ctx, args) => {
    return await completeRuntimeRunImpl(ctx, args);
  },
});
