import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Id } from "../../../database/convex/_generated/dataModel";
import type { PendingApprovalRecord, TaskExecutionOutcome, TaskRecord, ToolDescriptor } from "../types";
import {
  createMcpApprovalPrompt,
  runTaskNowWithApprovalElicitation,
} from "./server-approval";
import type { McpExecutorService } from "./server-contracts";

function createTaskRecord(overrides?: Partial<TaskRecord>): TaskRecord {
  const now = Date.now();
  return {
    id: "task_test",
    code: "console.log('test')",
    runtimeId: "local-bun",
    status: "running",
    timeoutMs: 15_000,
    metadata: {},
    workspaceId: "ws_test" as Id<"workspaces">,
    accountId: "account_test" as Id<"accounts">,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("runTaskNowWithApprovalElicitation resolves pending approvals while runTaskNow is waiting", async () => {
  const workspaceId = "ws_test" as Id<"workspaces">;
  const accountId = "account_test" as Id<"accounts">;
  const taskId = "task_test";

  let approvalStatus: "pending" | "approved" | "denied" = "pending";
  let resolveCalls = 0;

  const pendingApproval: PendingApprovalRecord = {
    id: "approval_test",
    taskId,
    toolPath: "github.issues.create",
    input: { title: "Ship elicitation", apiKey: "secret-value" },
    status: "pending",
    createdAt: Date.now(),
    task: {
      id: taskId,
      status: "running",
      runtimeId: "local-bun",
      timeoutMs: 15_000,
      createdAt: Date.now(),
    },
  };

  const service: McpExecutorService = {
    createTask: async () => ({ task: createTaskRecord({ status: "queued" }) }),
    getTask: async () => createTaskRecord(),
    subscribe: () => () => {},
    bootstrapAnonymousContext: async () => ({
      sessionId: "anon_session_test",
      workspaceId,
      clientId: "mcp",
      accountId,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }),
    listTools: async (): Promise<ToolDescriptor[]> => [],
    listPendingApprovals: async () => (approvalStatus === "pending" ? [pendingApproval] : []),
    resolveApproval: async (input) => {
      resolveCalls += 1;
      approvalStatus = input.decision;
      return { ok: true };
    },
  };

  const runTaskNow = async (): Promise<TaskExecutionOutcome> => {
    while (approvalStatus === "pending") {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (approvalStatus === "denied") {
      return {
        task: createTaskRecord({
          status: "denied",
          error: "Denied",
          completedAt: Date.now(),
          updatedAt: Date.now(),
        }),
      };
    }

    return {
      task: createTaskRecord({
        status: "completed",
        exitCode: 0,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }),
      result: { approved: true },
    };
  };

  const outcome = await runTaskNowWithApprovalElicitation(
    service,
    taskId,
    runTaskNow,
    async () => ({ decision: "approved" }),
    { workspaceId, accountId },
  );

  expect(resolveCalls).toBe(1);
  expect(outcome?.task.status).toBe("completed");
});

test("MCP client can connect and answer approval elicitation prompts", async () => {
  const server = new McpServer(
    { name: "approval-elicit-test-server", version: "0.0.1" },
    { capabilities: {} },
  );

  server.registerTool(
    "approval_prompt_demo",
    {
      description: "Runs approval prompt via MCP elicitation",
      inputSchema: {},
    },
    async () => {
      const prompt = createMcpApprovalPrompt(server);
      const decision = await prompt(
        {
          id: "approval_demo",
          taskId: "task_demo",
          toolPath: "github.issues.create",
          input: {
            title: "Create issue",
            apiKey: "super-secret-token",
            nested: { authorization: "Bearer token" },
          },
          status: "pending",
          createdAt: Date.now(),
          task: {
            id: "task_demo",
            status: "running",
            runtimeId: "local-bun",
            timeoutMs: 15_000,
            createdAt: Date.now(),
          },
        },
        {
          workspaceId: "ws_demo" as Id<"workspaces">,
          accountId: "account_demo" as Id<"accounts">,
        },
      );

      return {
        content: [{ type: "text", text: JSON.stringify(decision) }],
      };
    },
  );

  let elicitationMessage = "";
  const client = new Client(
    { name: "approval-elicit-test-client", version: "0.0.1" },
    { capabilities: { elicitation: { form: {} } } },
  );

  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    elicitationMessage = request.params.message;
    return {
      action: "accept",
      content: {
        decision: "approved",
        reason: "Looks good",
      },
    };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = (await client.callTool({ name: "approval_prompt_demo", arguments: {} })) as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = result.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain('"decision":"approved"');
    expect(text).toContain('"reason":"Looks good"');

    expect(elicitationMessage).toContain("[redacted]");
    expect(elicitationMessage).not.toContain("super-secret-token");
    expect(elicitationMessage).not.toContain("Bearer token");
  } finally {
    await client.close();
    await server.close();
  }
});
