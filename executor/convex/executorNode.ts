"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { InProcessExecutionAdapter } from "./lib/adapters/in_process_execution_adapter";
import { APPROVAL_DENIED_PREFIX } from "./lib/execution_constants";
import { runCodeWithAdapter } from "./lib/runtimes/runtime_core";
import { createDiscoverTool } from "./lib/tool_discovery";
import {
  loadExternalTools,
  parseGraphqlOperationPaths,
  type ExternalToolSourceConfig,
} from "./lib/tool_sources";
import { DEFAULT_TOOLS } from "./lib/tools";
import type {
  AccessPolicyRecord,
  CredentialScope,
  GraphqlToolSourceConfig,
  McpToolSourceConfig,
  OpenApiToolSourceConfig,
  PolicyDecision,
  ResolvedToolCredential,
  TaskEventPayloadByType,
  TaskEventType,
  TaskRecord,
  ToolCallRequest,
  ToolCallResult,
  ToolCredentialSpec,
  ToolDefinition,
  ToolDescriptor,
  ToolSourceRecord,
  ToolRunContext,
} from "./lib/types";
import { asPayload, describeError } from "./lib/utils";

function matchesToolPath(pattern: string, toolPath: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(toolPath);
}

function policySpecificity(policy: AccessPolicyRecord, actorId?: string, clientId?: string): number {
  let score = 0;
  if (policy.actorId && actorId && policy.actorId === actorId) score += 4;
  if (policy.clientId && clientId && policy.clientId === clientId) score += 2;
  score += Math.max(1, policy.toolPathPattern.replace(/\*/g, "").length);
  score += policy.priority;
  return score;
}

function sourceSignature(
  workspaceId: Id<"workspaces">,
  sources: Array<{ id: string; updatedAt: number; enabled: boolean }>,
): string {
  const parts = sources
    .map((source) => `${source.id}:${source.updatedAt}:${source.enabled ? 1 : 0}`)
    .sort();
  return `${workspaceId}|${parts.join(",")}`;
}

function normalizeExternalToolSource(raw:
  | { type: "mcp"; name: string; config: McpToolSourceConfig }
  | { type: "openapi"; name: string; config: OpenApiToolSourceConfig }
  | { type: "graphql"; name: string; config: GraphqlToolSourceConfig }
): ExternalToolSourceConfig {
  if (raw.type === "mcp") {
    if (typeof raw.config.url !== "string" || raw.config.url.trim().length === 0) {
      throw new Error(`MCP source '${raw.name}' missing url`);
    }

    if (
      raw.config.transport !== undefined
      && raw.config.transport !== "sse"
      && raw.config.transport !== "streamable-http"
    ) {
      throw new Error(`MCP source '${raw.name}' has invalid transport`);
    }

    if (raw.config.queryParams !== undefined) {
      const queryParams = raw.config.queryParams;
      if (!queryParams || typeof queryParams !== "object" || Array.isArray(queryParams)) {
        throw new Error(`MCP source '${raw.name}' queryParams must be an object`);
      }

      for (const value of Object.values(queryParams as Record<string, unknown>)) {
        if (typeof value !== "string") {
          throw new Error(`MCP source '${raw.name}' queryParams values must be strings`);
        }
      }
    }

    return {
      type: "mcp",
      name: raw.name,
      ...raw.config,
    };
  }

  if (raw.type === "graphql") {
    if (typeof raw.config.endpoint !== "string" || raw.config.endpoint.trim().length === 0) {
      throw new Error(`GraphQL source '${raw.name}' missing endpoint`);
    }
    return {
      type: "graphql",
      name: raw.name,
      ...raw.config,
    };
  }

  const spec = raw.config.spec;
  if (typeof spec !== "string" && typeof spec !== "object") {
    throw new Error(`OpenAPI source '${raw.name}' missing spec`);
  }

  return {
    type: "openapi",
    name: raw.name,
    ...raw.config,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const baseTools = new Map<string, ToolDefinition>(DEFAULT_TOOLS.map((tool) => [tool.path, tool]));
const workspaceToolCache = new Map<
  string,
  { signature: string; loadedAt: number; tools: Map<string, ToolDefinition>; warnings: string[] }
>();

async function publish(
  ctx: any,
  input: {
    [K in TaskEventType]: {
      taskId: Id<"tasks">;
      type: K;
    } & TaskEventPayloadByType[K];
  }[TaskEventType],
): Promise<void> {
  const { taskId, type, ...payload } = input;

  await ctx.runMutation(api.database.createTaskEvent, {
    taskId,
    type,
    payload: payload as unknown as Record<string, unknown>,
  });
}

async function waitForApproval(ctx: any, approvalId: Id<"approvals">): Promise<"approved" | "denied"> {
  while (true) {
    const approval = await ctx.runQuery(api.database.getApproval, { approvalId });
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    if (approval.status !== "pending") {
      return approval.status as "approved" | "denied";
    }

    await sleep(500);
  }
}

async function getWorkspaceTools(ctx: any, workspaceId: Id<"workspaces">): Promise<Map<string, ToolDefinition>> {
  const sources = (await ctx.runQuery(api.database.listToolSources, { workspaceId }))
    .filter((source: { enabled: boolean }) => source.enabled);
  const signature = sourceSignature(workspaceId, sources);
  const cached = workspaceToolCache.get(workspaceId);
  if (cached && cached.signature === signature) {
    return cached.tools;
  }

  const configs: ExternalToolSourceConfig[] = [];
  const warnings: string[] = [];
  for (const source of sources) {
    try {
      configs.push(normalizeExternalToolSource(source));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Source '${source.name}': ${message}`);
    }
  }

  const { tools: externalTools, warnings: loadWarnings } = await loadExternalTools(configs);
  warnings.push(...loadWarnings);

  const merged = new Map<string, ToolDefinition>();
  for (const tool of baseTools.values()) {
    if (tool.path === "discover") continue;
    merged.set(tool.path, tool);
  }
  for (const tool of externalTools) {
    merged.set(tool.path, tool);
  }

  const discover = createDiscoverTool([...merged.values()]);
  merged.set(discover.path, discover);

  workspaceToolCache.set(workspaceId, {
    signature,
    loadedAt: Date.now(),
    tools: merged,
    warnings,
  });

  return merged;
}

function getDecisionForContext(
  tool: ToolDefinition,
  context: { workspaceId: Id<"workspaces">; actorId?: string; clientId?: string },
  policies: AccessPolicyRecord[],
): PolicyDecision {
  const defaultDecision: PolicyDecision = tool.approval === "required" ? "require_approval" : "allow";
  const candidates = policies
    .filter((policy) => {
      if (policy.actorId && policy.actorId !== context.actorId) return false;
      if (policy.clientId && policy.clientId !== context.clientId) return false;
      return matchesToolPath(policy.toolPathPattern, tool.path);
    })
    .sort(
      (a, b) =>
        policySpecificity(b, context.actorId, context.clientId)
        - policySpecificity(a, context.actorId, context.clientId),
    );

  return candidates[0]?.decision ?? defaultDecision;
}

function getToolDecision(task: TaskRecord, tool: ToolDefinition, policies: AccessPolicyRecord[]): PolicyDecision {
  return getDecisionForContext(
    tool,
    {
      workspaceId: task.workspaceId,
      actorId: task.actorId,
      clientId: task.clientId,
    },
    policies,
  );
}

function isToolAllowedForTask(
  task: TaskRecord,
  toolPath: string,
  workspaceTools: Map<string, ToolDefinition>,
  policies: AccessPolicyRecord[],
): boolean {
  const tool = workspaceTools.get(toolPath);
  if (!tool) return false;
  return getToolDecision(task, tool, policies) !== "deny";
}

async function resolveCredentialHeaders(
  ctx: any,
  spec: ToolCredentialSpec,
  task: TaskRecord,
): Promise<ResolvedToolCredential | null> {
  const record = await ctx.runQuery(api.database.resolveCredential, {
    workspaceId: task.workspaceId,
    sourceKey: spec.sourceKey,
    scope: spec.mode as CredentialScope,
    actorId: task.actorId,
  });

  const source = record?.secretJson ?? spec.staticSecretJson ?? null;
  if (!source) {
    return null;
  }

  const headers: Record<string, string> = {};
  if (spec.authType === "bearer") {
    const token = String((source as Record<string, unknown>).token ?? "").trim();
    if (token) headers.authorization = `Bearer ${token}`;
  } else if (spec.authType === "apiKey") {
    const headerName = spec.headerName ?? String((source as Record<string, unknown>).headerName ?? "x-api-key");
    const value = String((source as Record<string, unknown>).value ?? (source as Record<string, unknown>).token ?? "").trim();
    if (value) headers[headerName] = value;
  } else if (spec.authType === "basic") {
    const username = String((source as Record<string, unknown>).username ?? "");
    const password = String((source as Record<string, unknown>).password ?? "");
    if (username || password) {
      const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
      headers.authorization = `Basic ${encoded}`;
    }
  }

  if (Object.keys(headers).length === 0) {
    return null;
  }

  return {
    sourceKey: spec.sourceKey,
    mode: spec.mode,
    headers,
  };
}

function getGraphqlDecision(
  task: TaskRecord,
  tool: ToolDefinition,
  input: unknown,
  workspaceTools: Map<string, ToolDefinition>,
  policies: AccessPolicyRecord[],
): { decision: PolicyDecision; effectivePaths: string[] } {
  const sourceName = tool._graphqlSource!;
  const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const queryString = typeof payload.query === "string" ? payload.query : "";

  if (!queryString.trim()) {
    return { decision: getToolDecision(task, tool, policies), effectivePaths: [tool.path] };
  }

  const { fieldPaths } = parseGraphqlOperationPaths(sourceName, queryString);
  if (fieldPaths.length === 0) {
    return { decision: getToolDecision(task, tool, policies), effectivePaths: [tool.path] };
  }

  let worstDecision: PolicyDecision = "allow";

  for (const fieldPath of fieldPaths) {
    const pseudoTool = workspaceTools.get(fieldPath);
    const fieldDecision = pseudoTool
      ? getDecisionForContext(
          pseudoTool,
          {
            workspaceId: task.workspaceId,
            actorId: task.actorId,
            clientId: task.clientId,
          },
          policies,
        )
      : getDecisionForContext(
          { ...tool, path: fieldPath, approval: fieldPath.includes(".mutation.") ? "required" : "auto" },
          {
            workspaceId: task.workspaceId,
            actorId: task.actorId,
            clientId: task.clientId,
          },
          policies,
        );

    if (fieldDecision === "deny") {
      worstDecision = "deny";
      break;
    }
    if (fieldDecision === "require_approval") {
      worstDecision = "require_approval";
    }
  }

  return { decision: worstDecision, effectivePaths: fieldPaths };
}

async function invokeTool(ctx: any, task: TaskRecord, call: ToolCallRequest): Promise<unknown> {
  const { toolPath, input, callId } = call;
  const [workspaceTools, policies] = await Promise.all([
    getWorkspaceTools(ctx, task.workspaceId),
    ctx.runQuery(api.database.listAccessPolicies, { workspaceId: task.workspaceId }),
  ]);
  const typedPolicies = policies as AccessPolicyRecord[];

  const tool = workspaceTools.get(toolPath);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolPath}`);
  }

  let decision: PolicyDecision;
  let effectiveToolPath = toolPath;
  if (tool._graphqlSource) {
    const result = getGraphqlDecision(task, tool, input, workspaceTools, typedPolicies);
    decision = result.decision;
    if (result.effectivePaths.length > 0) {
      effectiveToolPath = result.effectivePaths.join(", ");
    }
  } else {
    decision = getToolDecision(task, tool, typedPolicies);
  }

  if (decision === "deny") {
    await publish(ctx, {
      taskId: task.id,
      type: "tool.call.denied",
      callId,
      toolPath: effectiveToolPath,
      reason: "policy_deny",
    });
    throw new Error(`${APPROVAL_DENIED_PREFIX}${effectiveToolPath} (policy denied)`);
  }

  let credential: ResolvedToolCredential | undefined;
  if (tool.credential) {
    const resolved = await resolveCredentialHeaders(ctx, tool.credential, task);
    if (!resolved) {
      throw new Error(`Missing credential for source '${tool.credential.sourceKey}' (${tool.credential.mode} scope)`);
    }
    credential = resolved;
  }

  await publish(ctx, {
    taskId: task.id,
    type: "tool.call.started",
    callId,
    toolPath: effectiveToolPath,
    approval: decision === "require_approval" ? "required" : "auto",
    input: asPayload(input),
  });

  if (decision === "require_approval") {
    const approval = await ctx.runMutation(api.database.createApproval, {
      taskId: task.id,
      toolPath: effectiveToolPath,
      input,
    });

    await publish(ctx, {
      approvalId: approval.id,
      taskId: task.id,
      type: "approval.requested",
      callId,
      toolPath: approval.toolPath,
      input: asPayload(approval.input),
      createdAt: approval.createdAt,
    });

    const approvalDecision = await waitForApproval(ctx, approval.id);
    if (approvalDecision === "denied") {
      await publish(ctx, {
        taskId: task.id,
        type: "tool.call.denied",
        callId,
        toolPath: effectiveToolPath,
        approvalId: approval.id,
      });
      throw new Error(`${APPROVAL_DENIED_PREFIX}${effectiveToolPath} (${approval.id})`);
    }
  }

  try {
    const context: ToolRunContext = {
      taskId: task.id,
      workspaceId: task.workspaceId,
      actorId: task.actorId,
      clientId: task.clientId,
      credential,
      isToolAllowed: (path) => isToolAllowedForTask(task, path, workspaceTools, typedPolicies),
    };
    const value = await tool.run(input, context);
    await publish(ctx, {
      taskId: task.id,
      type: "tool.call.completed",
      callId,
      toolPath: effectiveToolPath,
      output: asPayload(value),
    });
    return value;
  } catch (error) {
    const message = describeError(error);
    await publish(ctx, {
      taskId: task.id,
      type: "tool.call.failed",
      callId,
      toolPath: effectiveToolPath,
      error: message,
    });
    throw error;
  }
}

export const listTools = action({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ToolDescriptor[]> => {
    if (!args.workspaceId) {
      return [...baseTools.values()].map((tool) => ({
        path: tool.path,
        description: tool.description,
        approval: tool.approval,
        source: tool.source,
        argsType: tool.metadata?.argsType,
        returnsType: tool.metadata?.returnsType,
      }));
    }

    const [workspaceTools, policies] = await Promise.all([
      getWorkspaceTools(ctx, args.workspaceId),
      ctx.runQuery(api.database.listAccessPolicies, { workspaceId: args.workspaceId }),
    ]);
    const typedPolicies = policies as AccessPolicyRecord[];
    const listContext = {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      clientId: args.clientId,
    };
    const all = [...workspaceTools.values()];

    return all
      .filter((tool) => {
        const decision = getDecisionForContext(tool, listContext, typedPolicies);
        return decision !== "deny";
      })
      .map((tool) => {
        const decision = getDecisionForContext(tool, listContext, typedPolicies);
        return {
          path: tool.path,
          description: tool.description,
          approval: decision === "require_approval" ? "required" : "auto",
          source: tool.source,
          argsType: tool.metadata?.argsType,
          returnsType: tool.metadata?.returnsType,
        };
      });
  },
});

export const handleExternalToolCall = internalAction({
  args: {
    runId: v.id("tasks"),
    callId: v.string(),
    toolPath: v.string(),
    input: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args): Promise<ToolCallResult> => {
    const task = (await ctx.runQuery(api.database.getTask, {
      taskId: args.runId,
    })) as TaskRecord | null;
    if (!task) {
      return {
        ok: false,
        error: `Run not found: ${args.runId}`,
      };
    }

    try {
      const value = await invokeTool(ctx, task, {
        runId: args.runId,
        callId: args.callId,
        toolPath: args.toolPath,
        input: args.input ?? {},
      });
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
  },
});

export const runTask = internalAction({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = (await ctx.runQuery(api.database.getTask, { taskId: args.taskId })) as TaskRecord | null;
    if (!task || task.status !== "queued") {
      return null;
    }

    if (task.runtimeId !== "local-bun") {
      const failed = await ctx.runMutation(api.database.markTaskFinished, {
        taskId: args.taskId,
        status: "failed",
        stdout: "",
        stderr: "",
        error: `Runtime not found: ${task.runtimeId}`,
      });

      if (failed) {
        await publish(ctx, {
          taskId: args.taskId,
          type: "task.failed",
          status: "failed",
          error: failed.error,
        });
      }
      return null;
    }

    try {
      const running = (await ctx.runMutation(api.database.markTaskRunning, {
        taskId: args.taskId,
      })) as TaskRecord | null;
      if (!running) {
        return null;
      }

      await publish(ctx, {
        taskId: args.taskId,
        type: "task.running",
        status: "running",
        startedAt: running.startedAt,
      });

      const adapter = new InProcessExecutionAdapter({
        runId: args.taskId,
        invokeTool: async (call) => await invokeTool(ctx, running, call),
        emitOutput: async (event) => {
          await ctx.runMutation(internal.executor.appendRuntimeOutput, {
            runId: event.runId,
            stream: event.stream,
            line: event.line,
            timestamp: event.timestamp,
          });
        },
      });

      const runtimeResult = await runCodeWithAdapter(
        {
          taskId: args.taskId,
          code: running.code,
          timeoutMs: running.timeoutMs,
        },
        adapter,
      );

      const finished = await ctx.runMutation(api.database.markTaskFinished, {
        taskId: args.taskId,
        status: runtimeResult.status,
        stdout: runtimeResult.stdout,
        stderr: runtimeResult.stderr,
        exitCode: runtimeResult.exitCode,
        error: runtimeResult.error,
      });

      if (!finished) {
        return null;
      }

      const terminalEvent =
        runtimeResult.status === "completed"
          ? "task.completed"
          : runtimeResult.status === "timed_out"
            ? "task.timed_out"
            : runtimeResult.status === "denied"
              ? "task.denied"
              : "task.failed";

      await publish(ctx, {
        taskId: args.taskId,
        type: terminalEvent,
        status: runtimeResult.status,
        exitCode: finished.exitCode,
        durationMs: runtimeResult.durationMs,
        error: finished.error,
        completedAt: finished.completedAt,
      });
    } catch (error) {
      const message = describeError(error);
      const denied = message.startsWith(APPROVAL_DENIED_PREFIX);
      const finished = await ctx.runMutation(api.database.markTaskFinished, {
        taskId: args.taskId,
        status: denied ? "denied" : "failed",
        stdout: "",
        stderr: "",
        error: denied ? message.replace(APPROVAL_DENIED_PREFIX, "") : message,
      });

      if (finished) {
        await publish(ctx, {
          taskId: args.taskId,
          type: denied ? "task.denied" : "task.failed",
          status: denied ? "denied" : "failed",
          error: finished.error,
          completedAt: finished.completedAt,
        });
      }
    }

    return null;
  },
});
