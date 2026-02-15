"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import type {
  ToolCallResult,
  ToolDescriptor,
  OpenApiSourceQuality,
  SourceAuthProfile,
} from "../../../core/src/types";
import {
  listToolsForContext,
  listToolsWithWarningsForContext,
  type WorkspaceToolsDebug,
} from "../../runtime/workspace_tools";
import { runQueuedTask } from "../../runtime/task_runner";
import { handleExternalToolCallRequest } from "../../runtime/external_tool_call";

export const listToolsInternal = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ToolDescriptor[]> => {
    return await listToolsForContext(ctx, args);
  },
});

export const listToolsWithWarningsInternal = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    tools: ToolDescriptor[];
    warnings: string[];
    typesUrl?: string;
    sourceQuality: Record<string, OpenApiSourceQuality>;
    sourceAuthProfiles: Record<string, SourceAuthProfile>;
    debug: WorkspaceToolsDebug;
  }> => {
    return await listToolsWithWarningsForContext(ctx, args);
  },
});

export const handleExternalToolCall = internalAction({
  args: {
    runId: v.string(),
    callId: v.string(),
    toolPath: v.string(),
    input: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<ToolCallResult> => await handleExternalToolCallRequest(ctx, args),
});

export const runTask = internalAction({
  args: { taskId: v.string() },
  handler: async (ctx, args) => await runQueuedTask(ctx, args),
});
