import type { ActionCtx } from "../../convex/_generated/server";
import { internal } from "../../convex/_generated/api";
import { decodeToolCallControlSignal } from "../../../core/src/tool-call-control";
import {
  CLOUDFLARE_WORKER_LOADER_RUNTIME_ID,
  isCloudflareWorkerLoaderConfigured,
  isKnownRuntimeId,
  isRuntimeEnabled,
} from "../../../core/src/runtimes/runtime-catalog";
import type { TaskExecutionOutcome, TaskRecord } from "../../../core/src/types";
import { describeError } from "../../../core/src/utils";
import { publishTaskEvent } from "./events";
import { taskTerminalEventType } from "../task/status";
import { markTaskFinished } from "../task/finish";

async function getTaskById(ctx: ActionCtx, taskId: string): Promise<TaskRecord | null> {
  const task: TaskRecord | null = await ctx.runQuery(internal.database.getTask, { taskId });
  return task;
}

async function markTaskRunning(
  ctx: ActionCtx,
  taskId: string,
): Promise<TaskRecord | null> {
  const runningTask: TaskRecord | null = await ctx.runMutation(internal.database.markTaskRunning, {
    taskId,
  });
  return runningTask;
}

async function markTaskFailedAndPublish(
  ctx: ActionCtx,
  args: { taskId: string; error: string },
): Promise<TaskExecutionOutcome | null> {
  const failed = await markTaskFinished(ctx, {
    taskId: args.taskId,
    status: "failed",
    error: args.error,
  });

  if (!failed) {
    return null;
  }

  await publishTaskEvent(ctx, args.taskId, "task", "task.failed", {
    taskId: args.taskId,
    status: failed.status,
    error: failed.error,
    ...(failed.completedAt ? { completedAt: failed.completedAt } : {}),
  });

  return { task: failed };
}

async function publishTerminalTaskResult(
  ctx: ActionCtx,
  args: {
    taskId: string;
    status: "completed" | "failed" | "timed_out" | "denied";
    finished: TaskRecord;
    durationMs?: number;
  },
): Promise<void> {
  await publishTaskEvent(ctx, args.taskId, "task", taskTerminalEventType(args.status), {
    taskId: args.taskId,
    status: args.finished.status,
    exitCode: args.finished.exitCode,
    durationMs: args.durationMs,
    error: args.finished.error,
    completedAt: args.finished.completedAt,
  });
}

export async function runQueuedTask(
  ctx: ActionCtx,
  args: { taskId: string },
): Promise<TaskExecutionOutcome | null> {
  const task = await getTaskById(ctx, args.taskId);
  if (!task || task.status !== "queued") {
    return null;
  }

  if (!isKnownRuntimeId(task.runtimeId)) {
    return await markTaskFailedAndPublish(ctx, {
      taskId: args.taskId,
      error: `Runtime not found: ${task.runtimeId}`,
    });
  }

  if (!isRuntimeEnabled(task.runtimeId)) {
    return await markTaskFailedAndPublish(ctx, {
      taskId: args.taskId,
      error: `Runtime is disabled for this deployment: ${task.runtimeId}`,
    });
  }

  if (task.runtimeId === CLOUDFLARE_WORKER_LOADER_RUNTIME_ID && !isCloudflareWorkerLoaderConfigured()) {
    return await markTaskFailedAndPublish(ctx, {
      taskId: args.taskId,
      error: `Runtime is not configured: ${task.runtimeId}`,
    });
  }

  try {
    const running = await markTaskRunning(ctx, args.taskId);
    if (!running) {
      return null;
    }

    await publishTaskEvent(ctx, args.taskId, "task", "task.running", {
      taskId: args.taskId,
      status: running.status,
      startedAt: running.startedAt,
    });

    if (running.runtimeId === CLOUDFLARE_WORKER_LOADER_RUNTIME_ID) {
      const dispatchResult = await ctx.runAction(internal.runtimeNode.dispatchCloudflareWorker, {
        taskId: args.taskId,
        code: running.code,
        timeoutMs: running.timeoutMs,
      });

      if (!dispatchResult.ok) {
        return await markTaskFailedAndPublish(ctx, {
          taskId: args.taskId,
          error: dispatchResult.error,
        });
      }

      const finished = await markTaskFinished(ctx, {
        taskId: args.taskId,
        status: dispatchResult.status,
        exitCode: dispatchResult.exitCode,
        error: dispatchResult.error,
      });

      if (!finished) {
        return null;
      }

      await publishTerminalTaskResult(ctx, {
        taskId: args.taskId,
        status: dispatchResult.status,
        finished,
        durationMs: dispatchResult.durationMs,
      });
      return {
        task: finished,
        result: dispatchResult.result,
        durationMs: dispatchResult.durationMs,
      };
    }

    const runtimeResult = await ctx.runAction(internal.runtimeNode.executeLocalVm, {
      taskId: args.taskId,
      code: running.code,
      timeoutMs: running.timeoutMs,
    });

    const finished = await markTaskFinished(ctx, {
      taskId: args.taskId,
      status: runtimeResult.status,
      exitCode: runtimeResult.exitCode,
      error: runtimeResult.error,
    });

    if (!finished) {
      return null;
    }

    await publishTerminalTaskResult(ctx, {
      taskId: args.taskId,
      status: runtimeResult.status,
      finished,
      durationMs: runtimeResult.durationMs,
    });
    return {
      task: finished,
      result: runtimeResult.result,
      durationMs: runtimeResult.durationMs,
    };
  } catch (error) {
    const message = describeError(error);
    const controlSignal = decodeToolCallControlSignal(error);
    const denied = controlSignal?.kind === "approval_denied";
    const finished = await markTaskFinished(ctx, {
      taskId: args.taskId,
      status: denied ? "denied" : "failed",
      error: denied ? controlSignal.reason : message,
    });

    if (finished) {
      await publishTerminalTaskResult(ctx, {
        taskId: args.taskId,
        status: denied ? "denied" : "failed",
        finished,
      });
      return { task: finished };
    }
  }

  return null;
}
