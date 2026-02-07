/**
 * Task runner — wires createAgent to the task state system.
 *
 * Starts an agent run for a task, emitting TaskEvents to state,
 * with approval resolution via the pending approval registry.
 */

import { createRemoteRunner } from "@openassistant/core";
import type { ToolDefinition, ToolTree, ApprovalRequest, ApprovalDecision } from "@openassistant/core/tools";
import { isToolDefinition } from "@openassistant/core/tools";
import type { LanguageModel } from "@openassistant/core/agent";
import { createAgent } from "@openassistant/core/agent";
import {
  emitTaskEvent,
  getTask,
  registerRemoteRunSession,
  registerApproval,
  removeRemoteRunSession,
  type RemoteRunInvokeResult,
} from "./state.js";

export interface TaskRunnerOptions {
  readonly tools: ToolTree;
  readonly model: LanguageModel;
  /** Additional context for the system prompt (project IDs, org info, etc.) */
  readonly context?: string | undefined;
  /** Optional remote executor config. If omitted, uses in-process runner. */
  readonly executor?: {
    readonly url: string;
    readonly callbackBaseUrl: string;
  } | undefined;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildFallbackApprovalPreview(toolPath: string, input: unknown) {
  return {
    title: `Run via ${toolPath}`,
    details: `Arguments: ${JSON.stringify(input)}`,
    action: "execute" as const,
  };
}

function resolveToolDefinition(tools: ToolTree, toolPath: string): ToolDefinition | undefined {
  const parts = toolPath.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;

  let current: ToolTree | ToolDefinition = tools;
  for (const part of parts) {
    if (isToolDefinition(current)) return undefined;
    const next = current[part];
    if (!next) return undefined;
    current = next as ToolTree | ToolDefinition;
  }

  return isToolDefinition(current) ? current : undefined;
}

/**
 * Run an agent turn for a task. Emits events to the task's event stream
 * and registers approval requests that can be resolved via the REST API.
 */
export async function runTask(
  taskId: string,
  prompt: string,
  options: TaskRunnerOptions,
): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const requestApproval = (request: ApprovalRequest): Promise<ApprovalDecision> => {
    // Emit the approval_request event so SSE subscribers see it
    emitTaskEvent(taskId, {
      type: "approval_request",
      id: request.callId,
      toolPath: request.toolPath,
      input: request.input,
      preview: request.preview,
    });

    return new Promise<ApprovalDecision>((resolve) => {
      registerApproval({
        callId: request.callId,
        taskId,
        toolPath: request.toolPath,
        input: request.input,
        resolve: (decision: ApprovalDecision) => {
          // Emit resolved event before unblocking the runner
          emitTaskEvent(taskId, {
            type: "approval_resolved",
            id: request.callId,
            decision,
          });
          resolve(decision);
        },
      });
    });
  };

  let approvalSeq = 0;
  const invokeToolForRemoteRun = async (
    toolPath: string,
    input: unknown,
  ): Promise<RemoteRunInvokeResult> => {
    const tool = resolveToolDefinition(options.tools, toolPath);
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${toolPath}` };
    }

    const parseResult = tool.args.safeParse(input);
    if (!parseResult.success) {
      return {
        ok: false,
        error: `Input validation failed: ${parseResult.error.message}`,
      };
    }

    const validatedInput = parseResult.data;
    if (tool.approval === "required") {
      const approvalDecision = await requestApproval({
        callId: `remote_${taskId}_${++approvalSeq}`,
        toolPath,
        input: validatedInput,
        preview: tool.formatApproval
          ? tool.formatApproval(validatedInput)
          : buildFallbackApprovalPreview(toolPath, validatedInput),
      });

      if (approvalDecision === "denied") {
        return {
          ok: true,
          denied: true,
          error: `Tool call denied: ${toolPath}`,
        };
      }
    }

    try {
      const value = await tool.run(validatedInput);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  };

  const runId = `run_${taskId}_${Date.now().toString(36)}`;
  let registeredRemoteRun = false;

  const remoteRunner = options.executor
    ? (() => {
      const callbackToken = crypto.randomUUID();
      registerRemoteRunSession({
        runId,
        token: callbackToken,
        invokeTool: invokeToolForRemoteRun,
      });
      registeredRemoteRun = true;

      return createRemoteRunner({
        tools: options.tools,
        executorUrl: options.executor.url,
        runId,
        callbackBaseUrl: options.executor.callbackBaseUrl,
        callbackToken,
      });
    })()
    : undefined;

  const agent = createAgent({
    tools: options.tools,
    model: options.model,
    context: options.context,
    requestApproval,
    runner: remoteRunner,
    onEvent: (event) => {
      emitTaskEvent(taskId, event);
    },
  });

  try {
    await agent.run(prompt);
  } catch (error) {
    const message = describeError(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[task ${taskId}] agent error:`, message);
    if (stack) console.error(stack);
    emitTaskEvent(taskId, {
      type: "error",
      error: message,
    });
  } finally {
    if (registeredRemoteRun) {
      removeRemoteRunSession(runId);
    }
  }
}
