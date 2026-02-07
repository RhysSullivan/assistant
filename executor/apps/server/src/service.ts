import { ExecutorDatabase } from "./database";
import { TaskEventHub, type LiveTaskEvent } from "./events";
import { InProcessExecutionAdapter } from "./adapters/in-process-execution-adapter";
import { APPROVAL_DENIED_PREFIX } from "./execution-constants";
import type {
  ApprovalRecord,
  ApprovalStatus,
  CreateTaskInput,
  PendingApprovalRecord,
  SandboxRuntime,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  ToolCallResult,
  ToolCallRequest,
  ToolDefinition,
  ToolDescriptor,
  RuntimeOutputEvent,
} from "./types";

interface ApprovalWaiter {
  resolve: (decision: Exclude<ApprovalStatus, "pending">) => void;
}

function createTaskId(): string {
  return `task_${crypto.randomUUID()}`;
}

function createApprovalId(): string {
  return `approval_${crypto.randomUUID()}`;
}

function asPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { value };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ExecutorService {
  private readonly db: ExecutorDatabase;
  private readonly hub: TaskEventHub;
  private readonly runtimes = new Map<string, SandboxRuntime>();
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly inFlightTaskIds = new Set<string>();
  private readonly approvalWaiters = new Map<string, ApprovalWaiter>();

  constructor(
    db: ExecutorDatabase,
    hub: TaskEventHub,
    runtimes: SandboxRuntime[],
    tools: ToolDefinition[],
  ) {
    this.db = db;
    this.hub = hub;
    for (const runtime of runtimes) {
      this.runtimes.set(runtime.id, runtime);
    }
    for (const tool of tools) {
      this.tools.set(tool.path, tool);
    }
  }

  listTasks(): TaskRecord[] {
    return this.db.listTasks();
  }

  getTask(taskId: string): TaskRecord | null {
    return this.db.getTask(taskId);
  }

  listTaskEvents(taskId: string): TaskEventRecord[] {
    return this.db.listTaskEvents(taskId);
  }

  subscribe(taskId: string, listener: (event: LiveTaskEvent) => void): () => void {
    return this.hub.subscribe(taskId, listener);
  }

  listApprovals(status?: ApprovalStatus): ApprovalRecord[] {
    return this.db.listApprovals(status);
  }

  listPendingApprovals(): PendingApprovalRecord[] {
    return this.db.listPendingApprovals();
  }

  listTools(): ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      path: tool.path,
      description: tool.description,
      approval: tool.approval,
      source: tool.source,
      argsType: tool.metadata?.argsType,
      returnsType: tool.metadata?.returnsType,
    }));
  }

  listRuntimes(): Array<{ id: string; label: string; description: string }> {
    return [...this.runtimes.values()].map((runtime) => ({
      id: runtime.id,
      label: runtime.label,
      description: runtime.description,
    }));
  }

  createTask(input: CreateTaskInput): { task: TaskRecord } {
    if (!input.code || input.code.trim().length === 0) {
      throw new Error("Task code is required");
    }

    const runtimeId = input.runtimeId ?? "local-bun";
    if (!this.runtimes.has(runtimeId)) {
      throw new Error(`Unknown runtime: ${runtimeId}`);
    }

    const task = this.db.createTask({
      id: createTaskId(),
      code: input.code,
      runtimeId,
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
    });

    this.publish(task.id, "task", "task.created", {
      taskId: task.id,
      status: task.status,
      runtimeId: task.runtimeId,
      timeoutMs: task.timeoutMs,
      createdAt: task.createdAt,
    });

    this.publish(task.id, "task", "task.queued", {
      taskId: task.id,
      status: "queued",
    });

    void this.executeTask(task.id);
    return { task };
  }

  resolveApproval(
    approvalId: string,
    decision: "approved" | "denied",
    reviewerId?: string,
    reason?: string,
  ): { approval: ApprovalRecord; task: TaskRecord } | null {
    const approval = this.db.resolveApproval({
      approvalId,
      decision,
      reviewerId,
      reason,
    });

    if (!approval) {
      return null;
    }

    this.publish(approval.taskId, "approval", "approval.resolved", {
      approvalId: approval.id,
      taskId: approval.taskId,
      toolPath: approval.toolPath,
      decision: approval.status,
      reviewerId: approval.reviewerId,
      reason: approval.reason,
      resolvedAt: approval.resolvedAt,
    });

    const waiter = this.approvalWaiters.get(approval.id);
    if (waiter) {
      this.approvalWaiters.delete(approval.id);
      waiter.resolve(approval.status as "approved" | "denied");
    }

    const task = this.db.getTask(approval.taskId);
    if (!task) {
      throw new Error(`Task ${approval.taskId} missing while resolving approval`);
    }

    return { approval, task };
  }

  async handleExternalToolCall(call: ToolCallRequest): Promise<ToolCallResult> {
    const task = this.db.getTask(call.runId);
    if (!task) {
      return {
        ok: false,
        error: `Run not found: ${call.runId}`,
      };
    }

    try {
      const value = await this.invokeTool(task, call);
      return { ok: true, value };
    } catch (error) {
      const message = describeError(error);
      if (message.startsWith(APPROVAL_DENIED_PREFIX)) {
        return {
          ok: false,
          denied: true,
          error: message.replace(APPROVAL_DENIED_PREFIX, "").trim(),
        };
      }

      return {
        ok: false,
        error: message,
      };
    }
  }

  appendRuntimeOutput(event: RuntimeOutputEvent): void {
    this.publish(
      event.runId,
      "task",
      event.stream === "stdout" ? "task.stdout" : "task.stderr",
      {
        taskId: event.runId,
        line: event.line,
        timestamp: event.timestamp,
      },
    );
  }

  private publish(
    taskId: string,
    eventName: TaskEventRecord["eventName"],
    type: string,
    payload: Record<string, unknown>,
  ): void {
    const event = this.db.createTaskEvent({ taskId, eventName, type, payload });
    this.hub.publish(taskId, {
      id: event.id,
      eventName,
      payload,
      createdAt: event.createdAt,
    });
  }

  private async waitForApproval(approvalId: string): Promise<"approved" | "denied"> {
    const approval = this.db.getApproval(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    if (approval.status !== "pending") {
      return approval.status as "approved" | "denied";
    }

    return await new Promise<"approved" | "denied">((resolve) => {
      this.approvalWaiters.set(approvalId, { resolve });
    });
  }

  private async invokeTool(task: TaskRecord, call: ToolCallRequest): Promise<unknown> {
    const { toolPath, input, callId } = call;
    const tool = this.tools.get(toolPath);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolPath}`);
    }

    this.publish(task.id, "task", "tool.call.started", {
      taskId: task.id,
      callId,
      toolPath,
      approval: tool.approval,
      input: asPayload(input),
    });

    if (tool.approval === "required") {
      const approval = this.db.createApproval({
        id: createApprovalId(),
        taskId: task.id,
        toolPath,
        input,
      });

      this.publish(task.id, "approval", "approval.requested", {
        approvalId: approval.id,
        taskId: task.id,
        callId,
        toolPath: approval.toolPath,
        input: asPayload(approval.input),
        createdAt: approval.createdAt,
      });

      const decision = await this.waitForApproval(approval.id);
      if (decision === "denied") {
        this.publish(task.id, "task", "tool.call.denied", {
          taskId: task.id,
          callId,
          toolPath,
          approvalId: approval.id,
        });
        throw new Error(`${APPROVAL_DENIED_PREFIX}${toolPath} (${approval.id})`);
      }
    }

    try {
      const value = await tool.run(input);
      this.publish(task.id, "task", "tool.call.completed", {
        taskId: task.id,
        callId,
        toolPath,
        output: asPayload(value),
      });
      return value;
    } catch (error) {
      const message = describeError(error);
      this.publish(task.id, "task", "tool.call.failed", {
        taskId: task.id,
        callId,
        toolPath,
        error: message,
      });
      throw error;
    }
  }

  private async executeTask(taskId: string): Promise<void> {
    if (this.inFlightTaskIds.has(taskId)) {
      return;
    }

    this.inFlightTaskIds.add(taskId);
    try {
      const task = this.db.getTask(taskId);
      if (!task || task.status !== "queued") {
        return;
      }

      const runtime = this.runtimes.get(task.runtimeId);
      if (!runtime) {
        const failed = this.db.markTaskFinished({
          taskId,
          status: "failed",
          stdout: "",
          stderr: "",
          error: `Runtime not found: ${task.runtimeId}`,
        });

        if (failed) {
          this.publish(taskId, "task", "task.failed", {
            taskId,
            status: failed.status,
            error: failed.error,
          });
        }
        return;
      }

      const running = this.db.markTaskRunning(taskId);
      if (!running) {
        return;
      }

      this.publish(taskId, "task", "task.running", {
        taskId,
        status: running.status,
        startedAt: running.startedAt,
      });

      const adapter = new InProcessExecutionAdapter({
        runId: taskId,
        invokeTool: async (call) => await this.invokeTool(running, call),
        emitOutput: (event) => {
          this.appendRuntimeOutput(event);
        },
      });

      const runtimeResult = await runtime.run(
        {
          taskId,
          code: running.code,
          timeoutMs: running.timeoutMs,
        },
        adapter,
      );

      const finished = this.db.markTaskFinished({
        taskId,
        status: runtimeResult.status,
        stdout: runtimeResult.stdout,
        stderr: runtimeResult.stderr,
        exitCode: runtimeResult.exitCode,
        error: runtimeResult.error,
      });

      if (!finished) {
        return;
      }

      const terminalEvent =
        runtimeResult.status === "completed"
          ? "task.completed"
          : runtimeResult.status === "timed_out"
            ? "task.timed_out"
            : runtimeResult.status === "denied"
              ? "task.denied"
              : "task.failed";

      this.publish(taskId, "task", terminalEvent, {
        taskId,
        status: finished.status,
        exitCode: finished.exitCode,
        durationMs: runtimeResult.durationMs,
        error: finished.error,
        completedAt: finished.completedAt,
      });
    } catch (error) {
      const message = describeError(error);
      const denied = message.startsWith(APPROVAL_DENIED_PREFIX);
      const finished = this.db.markTaskFinished({
        taskId,
        status: denied ? "denied" : "failed",
        stdout: "",
        stderr: "",
        error: denied ? message.replace(APPROVAL_DENIED_PREFIX, "") : message,
      });

      if (finished) {
        this.publish(taskId, "task", denied ? "task.denied" : "task.failed", {
          taskId,
          status: finished.status,
          error: finished.error,
          completedAt: finished.completedAt,
        });
      }
    } finally {
      this.inFlightTaskIds.delete(taskId);
    }
  }
}

export function getTaskTerminalState(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "timed_out" || status === "denied";
}
