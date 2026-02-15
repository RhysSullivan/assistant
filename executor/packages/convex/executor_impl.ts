import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx } from "./_generated/server";
import { defaultRuntimeId, isKnownRuntimeId, isRuntimeEnabled } from "../core/src/runtimes/runtime-catalog";
import type { ApprovalRecord, TaskRecord } from "../core/src/types";
import { DEFAULT_TASK_TIMEOUT_MS } from "./task/constants";
import { isTerminalTaskStatus, taskTerminalEventType } from "./task/status";
import { createTaskEvent } from "./task/events";
import { markTaskFinished } from "./task/finish";
import { safeRunAfter } from "./lib/scheduler";

type TaskCreateContext = Pick<MutationCtx, "runMutation"> & {
  scheduler?: Pick<MutationCtx, "scheduler">["scheduler"];
};

export async function createTaskRecord(
  ctx: TaskCreateContext,
  args: {
    code: string;
    timeoutMs?: number;
    runtimeId?: string;
    metadata?: unknown;
    workspaceId: Id<"workspaces">;
    actorId: string;
    clientId?: string;
    scheduleAfterCreate?: boolean;
  },
): Promise<{ task: TaskRecord }> {
  if (!args.code.trim()) {
    throw new Error("Task code is required");
  }

  const runtimeId = args.runtimeId ?? defaultRuntimeId();
  if (!isKnownRuntimeId(runtimeId)) {
    throw new Error(`Unsupported runtime: ${runtimeId}`);
  }
  if (!isRuntimeEnabled(runtimeId)) {
    throw new Error(`Runtime is disabled for this deployment: ${runtimeId}`);
  }

  const taskId = `task_${crypto.randomUUID()}`;
  const task = (await ctx.runMutation(internal.database.createTask, {
    id: taskId,
    code: args.code,
    runtimeId,
    timeoutMs: args.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
    metadata: args.metadata,
    workspaceId: args.workspaceId,
    actorId: args.actorId,
    clientId: args.clientId,
  })) as TaskRecord;

  await createTaskEvent(ctx, {
    taskId,
    eventName: "task",
    type: "task.created",
    payload: {
      taskId,
      status: task.status,
      runtimeId: task.runtimeId,
      timeoutMs: task.timeoutMs,
      workspaceId: task.workspaceId,
      actorId: task.actorId,
      clientId: task.clientId,
      createdAt: task.createdAt,
    },
  });

  await createTaskEvent(ctx, {
    taskId,
    eventName: "task",
    type: "task.queued",
    payload: {
      taskId,
      status: "queued",
    },
  });

  if (args.scheduleAfterCreate ?? true) {
    if (!ctx.scheduler) {
      throw new Error("Task scheduling is unavailable in this execution context");
    }

    await safeRunAfter(ctx.scheduler, 1, internal.executorNode.runTask, { taskId });
  }

  return { task };
}

export async function resolveApprovalRecord(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    approvalId: string;
    decision: "approved" | "denied";
    reviewerId?: string;
    reason?: string;
  },
): Promise<{ approval: ApprovalRecord; task: TaskRecord } | null> {
  const scopedApproval = await ctx.runQuery(internal.database.getApprovalInWorkspace, {
    approvalId: args.approvalId,
    workspaceId: args.workspaceId,
  });
  if (!scopedApproval || scopedApproval.status !== "pending") {
    return null;
  }

  const approval = (await ctx.runMutation(internal.database.resolveApproval, {
    approvalId: args.approvalId,
    decision: args.decision,
    reviewerId: args.reviewerId,
    reason: args.reason,
  })) as ApprovalRecord | null;
  if (!approval) {
    return null;
  }

  await createTaskEvent(ctx, {
    taskId: approval.taskId,
    eventName: "approval",
    type: "approval.resolved",
    payload: {
      approvalId: approval.id,
      taskId: approval.taskId,
      toolPath: approval.toolPath,
      decision: approval.status,
      reviewerId: approval.reviewerId,
      reason: approval.reason,
      resolvedAt: approval.resolvedAt,
    },
  });

  const task = (await ctx.runQuery(internal.database.getTask, {
    taskId: approval.taskId,
  })) as TaskRecord | null;
  if (!task) {
    throw new Error(`Task ${approval.taskId} missing while resolving approval`);
  }

  return { approval, task };
}

export async function completeRuntimeRunImpl(
  ctx: MutationCtx,
  args: {
    runId: string;
    status: "completed" | "failed" | "timed_out" | "denied";
    exitCode?: number;
    error?: string;
    durationMs?: number;
  },
): Promise<
  | { ok: true; alreadyFinal: true; task: TaskRecord }
  | { ok: true; alreadyFinal: false; task: TaskRecord }
  | { ok: false; error: string }
> {
  const task = (await ctx.runQuery(internal.database.getTask, { taskId: args.runId })) as TaskRecord | null;
  if (!task) {
    return { ok: false as const, error: `Run not found: ${args.runId}` };
  }

  if (isTerminalTaskStatus(task.status)) {
    return { ok: true as const, alreadyFinal: true as const, task };
  }

  const finished = await markTaskFinished(ctx, {
    taskId: args.runId,
    status: args.status,
    exitCode: args.exitCode,
    error: args.error,
  });

  if (!finished) {
    return { ok: false as const, error: `Failed to mark run finished: ${args.runId}` };
  }

  await createTaskEvent(ctx, {
    taskId: args.runId,
    eventName: "task",
    type: taskTerminalEventType(args.status),
    payload: {
      taskId: args.runId,
      status: finished.status,
      exitCode: finished.exitCode,
      durationMs: args.durationMs,
      error: finished.error,
      completedAt: finished.completedAt,
    },
  });

  return { ok: true as const, alreadyFinal: false as const, task: finished };
}

export const completeRuntimeRunArgsValidator = {
  runId: v.string(),
  status: v.union(v.literal("completed"), v.literal("failed"), v.literal("timed_out"), v.literal("denied")),
  exitCode: v.optional(v.number()),
  error: v.optional(v.string()),
  durationMs: v.optional(v.number()),
};
