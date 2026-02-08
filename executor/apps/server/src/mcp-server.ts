import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { getTaskTerminalState } from "./service";
import type { AnonymousContext, CreateTaskInput, TaskRecord } from "./types";

interface McpExecutorService {
  createTask(input: CreateTaskInput): Promise<{ task: TaskRecord }>;
  getTask(taskId: string, workspaceId?: string): Promise<TaskRecord | null>;
  bootstrapAnonymousContext(sessionId?: string): Promise<AnonymousContext>;
}

const RUN_CODE_INPUT = {
  code: z.string().min(1),
  timeoutMs: z.number().int().min(1).max(600_000).optional(),
  runtimeId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  workspaceId: z.string().optional(),
  actorId: z.string().optional(),
  clientId: z.string().optional(),
  sessionId: z.string().optional(),
  waitForResult: z.boolean().optional(),
  resultTimeoutMs: z.number().int().min(100).max(900_000).optional(),
} as const;

type RunCodeInput = {
  code: string;
  timeoutMs?: number;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  workspaceId?: string;
  actorId?: string;
  clientId?: string;
  sessionId?: string;
  waitForResult?: boolean;
  resultTimeoutMs?: number;
};

function asCodeBlock(language: string, value: string): string {
  return `\n\n\`\`\`${language}\n${value}\n\`\`\``;
}

function textContent(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

function summarizeTask(task: TaskRecord): string {
  const lines = [
    `taskId: ${task.id}`,
    `status: ${task.status}`,
    `runtimeId: ${task.runtimeId}`,
  ];

  if (task.exitCode !== undefined) {
    lines.push(`exitCode: ${task.exitCode}`);
  }

  if (task.error) {
    lines.push(`error: ${task.error}`);
  }

  let text = lines.join("\n");
  if (task.stdout && task.stdout.trim()) {
    text += asCodeBlock("text", task.stdout);
  }
  if (task.stderr && task.stderr.trim()) {
    text += asCodeBlock("text", task.stderr);
  }
  return text;
}

async function waitForTerminalTask(
  service: McpExecutorService,
  taskId: string,
  workspaceId: string,
  waitTimeoutMs: number,
): Promise<TaskRecord | null> {
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    const task = await service.getTask(taskId, workspaceId);
    if (!task) {
      return null;
    }
    if (getTaskTerminalState(task.status)) {
      return task;
    }
    await Bun.sleep(300);
  }
  return await service.getTask(taskId, workspaceId);
}

async function resolveExecutionContext(
  service: McpExecutorService,
  input: RunCodeInput,
  mcpSessionId?: string,
): Promise<{ workspaceId: string; actorId: string; clientId?: string; sessionId?: string }> {
  if (input.workspaceId || input.actorId) {
    if (!input.workspaceId || !input.actorId) {
      throw new Error("workspaceId and actorId must be provided together");
    }
    return {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      clientId: input.clientId,
      sessionId: input.sessionId,
    };
  }

  const seededSessionId = input.sessionId ?? (mcpSessionId ? `mcp_${mcpSessionId}` : undefined);
  const anonymous = await service.bootstrapAnonymousContext(seededSessionId);
  return {
    workspaceId: anonymous.workspaceId,
    actorId: anonymous.actorId,
    clientId: input.clientId ?? anonymous.clientId,
    sessionId: anonymous.sessionId,
  };
}

function createRunCodeTool(service: McpExecutorService) {
  return async (
    input: RunCodeInput,
    extra: { sessionId?: string },
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }> => {
    const context = await resolveExecutionContext(service, input, extra.sessionId);

    const created = await service.createTask({
      code: input.code,
      timeoutMs: input.timeoutMs,
      runtimeId: input.runtimeId,
      metadata: input.metadata,
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      clientId: context.clientId,
    });

    const waitForResult = input.waitForResult ?? true;
    if (!waitForResult) {
      return {
        content: [textContent(`Queued task ${created.task.id}`)],
        structuredContent: {
          taskId: created.task.id,
          status: created.task.status,
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          sessionId: context.sessionId,
        },
      };
    }

    const waitTimeoutMs = input.resultTimeoutMs ?? Math.max((input.timeoutMs ?? created.task.timeoutMs) + 10_000, 15_000);
    const task = await waitForTerminalTask(service, created.task.id, context.workspaceId, waitTimeoutMs);

    if (!task) {
      return {
        content: [textContent(`Task ${created.task.id} not found while waiting for result`)],
        isError: true,
      };
    }

    if (!getTaskTerminalState(task.status)) {
      return {
        content: [textContent(`Task ${task.id} is still ${task.status}`)],
        structuredContent: {
          taskId: task.id,
          status: task.status,
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          sessionId: context.sessionId,
        },
      };
    }

    const isError = task.status !== "completed";
    return {
      content: [textContent(summarizeTask(task))],
      structuredContent: {
        taskId: task.id,
        status: task.status,
        runtimeId: task.runtimeId,
        exitCode: task.exitCode,
        error: task.error,
        stdout: task.stdout,
        stderr: task.stderr,
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        sessionId: context.sessionId,
      },
      ...(isError ? { isError: true } : {}),
    };
  };
}

function createMcpServer(service: McpExecutorService): McpServer {
  const mcp = new McpServer(
    { name: "executor", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  mcp.registerTool(
    "run_code",
    {
      description:
        "Run JavaScript/TypeScript code in the executor runtime. Defaults to waiting for terminal result and returns stdout/stderr.",
      inputSchema: RUN_CODE_INPUT,
    },
    createRunCodeTool(service),
  );

  return mcp;
}

export async function handleMcpRequest(service: McpExecutorService, request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const mcp = createMcpServer(service);

  try {
    await mcp.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close().catch(() => {});
    await mcp.close().catch(() => {});
  }
}
