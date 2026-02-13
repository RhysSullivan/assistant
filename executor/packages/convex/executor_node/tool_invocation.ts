"use node";

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { APPROVAL_PENDING_PREFIX } from "../../core/src/execution-constants";
import type {
  AccessPolicyRecord,
  PolicyDecision,
  ResolvedToolCredential,
  TaskRecord,
  ToolCallRecord,
  ToolCallRequest,
  ToolRunContext,
} from "../../core/src/types";
import { asPayload, describeError } from "../../core/src/utils";
import { getToolDecision, isToolAllowedForTask } from "./policy";
import { baseTools } from "./workspace_tools";
import { publishTaskEvent } from "./events";
import { completeToolCall, denyToolCall, failToolCall } from "./tool_call_lifecycle";
import { assertPersistedCallRunnable, resolveCredentialHeaders } from "./tool_call_credentials";
import { ensureWorkspaceTools, getGraphqlDecision, resolveToolForCall } from "./tool_call_resolution";

function createApprovalId(): string {
  return `approval_${crypto.randomUUID()}`;
}

async function denyToolCallForApproval(
  ctx: ActionCtx,
  args: {
    task: TaskRecord;
    callId: string;
    toolPath: string;
    approvalId: string;
  },
): Promise<never> {
  const deniedMessage = `${args.toolPath} (${args.approvalId})`;
  return await denyToolCall(ctx, {
    task: args.task,
    callId: args.callId,
    toolPath: args.toolPath,
    deniedMessage,
    approvalId: args.approvalId,
  });
}

export async function invokeTool(ctx: ActionCtx, task: TaskRecord, call: ToolCallRequest): Promise<unknown> {
  const { toolPath, input, callId } = call;
  const persistedCall = (await ctx.runMutation(internal.database.upsertToolCallRequested, {
    taskId: task.id,
    callId,
    workspaceId: task.workspaceId,
    toolPath,
  })) as ToolCallRecord;
  assertPersistedCallRunnable(persistedCall, callId);

  const policies = await ctx.runQuery(internal.database.listAccessPolicies, { workspaceId: task.workspaceId });
  const typedPolicies = policies as AccessPolicyRecord[];

  let { tool, resolvedToolPath, workspaceTools } = await resolveToolForCall(ctx, task, toolPath);

  let decision: PolicyDecision;
  let effectiveToolPath = resolvedToolPath;
  if (tool._graphqlSource) {
    workspaceTools = await ensureWorkspaceTools(ctx, task, workspaceTools);
    const result = getGraphqlDecision(task, tool, input, workspaceTools, typedPolicies);
    decision = result.decision;
    if (result.effectivePaths.length > 0) {
      effectiveToolPath = result.effectivePaths.join(", ");
    }
  } else {
    decision = getToolDecision(task, tool, typedPolicies);
  }

  const publishToolStarted = persistedCall.status === "requested";

  if (decision === "deny") {
    const deniedMessage = `${effectiveToolPath} (policy denied)`;
    await denyToolCall(ctx, {
      task,
      callId,
      toolPath: effectiveToolPath,
      deniedMessage,
      reason: "policy_deny",
    });
  }

  let credential: ResolvedToolCredential | undefined;
  if (tool.credential) {
    const resolved = await resolveCredentialHeaders(ctx, tool.credential, task);
    if (!resolved) {
      throw new Error(`Missing credential for source '${tool.credential.sourceKey}' (${tool.credential.mode} scope)`);
    }
    credential = resolved;
  }

  if (publishToolStarted) {
    await publishTaskEvent(ctx, task.id, "task", "tool.call.started", {
      taskId: task.id,
      callId,
      toolPath: effectiveToolPath,
      approval: decision === "require_approval" ? "required" : "auto",
    });
  }

  let approvalSatisfied = false;
  if (persistedCall.approvalId) {
    const existingApproval = await ctx.runQuery(internal.database.getApproval, {
      approvalId: persistedCall.approvalId,
    });
    if (!existingApproval) {
      throw new Error(`Approval ${persistedCall.approvalId} not found for call ${callId}`);
    }

    if (existingApproval.status === "pending") {
      throw new Error(`${APPROVAL_PENDING_PREFIX}${existingApproval.id}`);
    }

    if (existingApproval.status === "denied") {
      await denyToolCallForApproval(ctx, {
        task,
        callId,
        toolPath: effectiveToolPath,
        approvalId: existingApproval.id,
      });
    }

    approvalSatisfied = existingApproval.status === "approved";
  }

  if (decision === "require_approval" && !approvalSatisfied) {
    const approvalId = persistedCall.approvalId ?? createApprovalId();
    let approval = await ctx.runQuery(internal.database.getApproval, {
      approvalId,
    });

    if (!approval) {
      approval = await ctx.runMutation(internal.database.createApproval, {
        id: approvalId,
        taskId: task.id,
        toolPath: effectiveToolPath,
        input,
      });

      await publishTaskEvent(ctx, task.id, "approval", "approval.requested", {
        approvalId: approval.id,
        taskId: task.id,
        callId,
        toolPath: approval.toolPath,
        input: asPayload(approval.input),
        createdAt: approval.createdAt,
      });
    }

    await ctx.runMutation(internal.database.setToolCallPendingApproval, {
      taskId: task.id,
      callId,
      approvalId: approval.id,
    });

    if (approval.status === "pending") {
      throw new Error(`${APPROVAL_PENDING_PREFIX}${approval.id}`);
    }

    if (approval.status === "denied") {
      await denyToolCallForApproval(ctx, {
        task,
        callId,
        toolPath: effectiveToolPath,
        approvalId: approval.id,
      });
    }
  }

  try {
    const context: ToolRunContext = {
      taskId: task.id,
      workspaceId: task.workspaceId,
      actorId: task.actorId,
      clientId: task.clientId,
      credential,
      isToolAllowed: (path) => isToolAllowedForTask(task, path, workspaceTools ?? baseTools, typedPolicies),
    };
    const value = await tool.run(input, context);
    await completeToolCall(ctx, {
      taskId: task.id,
      callId,
      toolPath: effectiveToolPath,
    });
    return value;
  } catch (error) {
    const message = describeError(error);
    await failToolCall(ctx, {
      taskId: task.id,
      callId,
      error: message,
      toolPath: effectiveToolPath,
    });
    throw error;
  }
}
