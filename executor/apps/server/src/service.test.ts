import { expect, test } from "bun:test";
import { ExecutorDatabase } from "./database";
import { TaskEventHub } from "./events";
import { ExecutorService } from "./service";
import type {
  ExecutionAdapter,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxRuntime,
  ToolDefinition,
} from "./types";

class InlineToolRuntime implements SandboxRuntime {
  readonly id = "inline";
  readonly label = "Inline";
  readonly description = "Calls one tool then exits";

  async run(
    request: SandboxExecutionRequest,
    adapter: ExecutionAdapter,
  ): Promise<SandboxExecutionResult> {
    const startedAt = Date.now();
    const result = await adapter.invokeTool({
      runId: request.taskId,
      callId: "call_inline_1",
      toolPath: "admin.delete_data",
      input: { key: "abc" },
    });

    if (!result.ok) {
      return {
        status: result.denied ? "denied" : "failed",
        stdout: "",
        stderr: result.error,
        error: result.error,
        durationMs: Date.now() - startedAt,
      };
    }

    await adapter.emitOutput({
      runId: request.taskId,
      stream: "stdout",
      line: `tool_result:${JSON.stringify(result.value)}`,
      timestamp: Date.now(),
    });

    return {
      status: "completed",
      stdout: `task:${request.taskId}`,
      stderr: "",
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}

const tools: ToolDefinition[] = [
  {
    path: "admin.delete_data",
    description: "Requires approval",
    approval: "required",
    run: async (input) => ({ deleted: true, input }),
  },
];

test("tool-level approval gates individual function call", async () => {
  const service = new ExecutorService(
    new ExecutorDatabase(":memory:"),
    new TaskEventHub(),
    [new InlineToolRuntime()],
    tools,
  );

  const created = service.createTask({
    code: "unused",
    runtimeId: "inline",
    workspaceId: "ws_test",
    actorId: "actor_test",
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const approvals = service.listPendingApprovals("ws_test");

  expect(approvals.length).toBe(1);
  expect(approvals[0]?.toolPath).toBe("admin.delete_data");

  const resolved = service.resolveApproval("ws_test", approvals[0]!.id, "approved", "test-user");
  expect(resolved).toBeTruthy();

  await new Promise((resolve) => setTimeout(resolve, 20));
  const task = service.getTask(created.task.id);

  expect(task?.status).toBe("completed");
  expect(service.listApprovals("ws_test", "approved").length).toBe(1);
});
