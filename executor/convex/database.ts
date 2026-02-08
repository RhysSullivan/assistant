import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

const DEFAULT_TIMEOUT_MS = 15_000;

function normalizeOptional(value?: string): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function optionalFromNormalized(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value;
}

// NOTE: Canonical version lives in apps/server/src/utils.ts.
// Convex can't import from the server, so this is a local copy.
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapTask(doc: Doc<"tasks">) {
  return {
    id: doc.taskId,
    code: doc.code,
    runtimeId: doc.runtimeId,
    status: doc.status,
    timeoutMs: typeof doc.timeoutMs === "number" ? doc.timeoutMs : DEFAULT_TIMEOUT_MS,
    metadata: asRecord(doc.metadata),
    workspaceId: doc.workspaceId,
    actorId: optionalFromNormalized(doc.actorId),
    clientId: optionalFromNormalized(doc.clientId),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    startedAt: doc.startedAt,
    completedAt: doc.completedAt,
    error: doc.error,
    stdout: doc.stdout,
    stderr: doc.stderr,
    exitCode: doc.exitCode,
  };
}

function mapApproval(doc: Doc<"approvals">) {
  return {
    id: doc.approvalId,
    taskId: doc.taskId,
    toolPath: doc.toolPath,
    input: doc.input,
    status: doc.status,
    reason: doc.reason,
    reviewerId: doc.reviewerId,
    createdAt: doc.createdAt,
    resolvedAt: doc.resolvedAt,
  };
}

function mapPolicy(doc: Doc<"accessPolicies">) {
  return {
    id: doc.policyId,
    workspaceId: doc.workspaceId,
    actorId: optionalFromNormalized(doc.actorId),
    clientId: optionalFromNormalized(doc.clientId),
    toolPathPattern: doc.toolPathPattern,
    decision: doc.decision,
    priority: doc.priority,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapCredential(doc: Doc<"sourceCredentials">) {
  return {
    id: doc.credentialId,
    workspaceId: doc.workspaceId,
    sourceKey: doc.sourceKey,
    scope: doc.scope,
    actorId: optionalFromNormalized(doc.actorId),
    secretJson: asRecord(doc.secretJson),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapSource(doc: Doc<"toolSources">) {
  return {
    id: doc.sourceId,
    workspaceId: doc.workspaceId,
    name: doc.name,
    type: doc.type,
    config: asRecord(doc.config),
    enabled: Boolean(doc.enabled),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapAnonymousContext(doc: Doc<"anonymousSessions">) {
  return {
    sessionId: doc.sessionId,
    workspaceId: doc.workspaceId,
    actorId: doc.actorId,
    clientId: doc.clientId,
    createdAt: doc.createdAt,
    lastSeenAt: doc.lastSeenAt,
  };
}

function mapTaskEvent(doc: Doc<"taskEvents">) {
  return {
    id: doc.sequence,
    taskId: doc.taskId,
    eventName: doc.eventName,
    type: doc.type,
    payload: doc.payload,
    createdAt: doc.createdAt,
  };
}

function mapWorkspaceTool(doc: Doc<"workspaceTools">) {
  return {
    path: doc.path,
    description: doc.description,
    approval: doc.approval,
    source: doc.source,
    argsType: doc.argsType,
    returnsType: doc.returnsType,
  };
}

// NOTE: Duplicated in apps/server/src/service.ts — these must be kept in sync.
// They can't share code because Convex functions run in a separate environment.
function matchesToolPath(pattern: string, toolPath: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(toolPath);
}

// NOTE: Duplicated in apps/server/src/service.ts — these must be kept in sync.
function policySpecificity(
  policy: Pick<Doc<"accessPolicies">, "actorId" | "clientId" | "toolPathPattern" | "priority">,
  actorId?: string,
  clientId?: string,
): number {
  let score = 0;
  if (policy.actorId && actorId && policy.actorId === actorId) score += 4;
  if (policy.clientId && clientId && policy.clientId === clientId) score += 2;
  score += Math.max(1, String(policy.toolPathPattern ?? "").replace(/\*/g, "").length);
  score += Number(policy.priority ?? 0);
  return score;
}

async function getTaskDoc(ctx: { db: QueryCtx["db"] }, taskId: string) {
  return await ctx.db.query("tasks").withIndex("by_task_id", (q) => q.eq("taskId", taskId)).unique();
}

async function getApprovalDoc(ctx: { db: QueryCtx["db"] }, approvalId: string) {
  return await ctx.db
    .query("approvals")
    .withIndex("by_approval_id", (q) => q.eq("approvalId", approvalId))
    .unique();
}

export const createTask = mutation({
  args: {
    id: v.string(),
    code: v.string(),
    runtimeId: v.string(),
    timeoutMs: v.optional(v.number()),
    metadata: v.optional(v.any()),
    workspaceId: v.string(),
    actorId: v.string(),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await getTaskDoc(ctx, args.id);
    if (existing) {
      throw new Error(`Task already exists: ${args.id}`);
    }

    const now = Date.now();
    await ctx.db.insert("tasks", {
      taskId: args.id,
      code: args.code,
      runtimeId: args.runtimeId,
      workspaceId: args.workspaceId,
      actorId: normalizeOptional(args.actorId),
      clientId: normalizeOptional(args.clientId),
      status: "queued",
      timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      metadata: asRecord(args.metadata),
      createdAt: now,
      updatedAt: now,
    });

    const created = await getTaskDoc(ctx, args.id);
    if (!created) {
      throw new Error(`Failed to fetch created task ${args.id}`);
    }
    return mapTask(created);
  },
});

export const getTask = query({
  args: { taskId: v.string() },
  handler: async (ctx, args) => {
    const doc = await getTaskDoc(ctx, args.taskId);
    return doc ? mapTask(doc) : null;
  },
});

export const listTasks = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("tasks")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(500);
    return docs.map(mapTask);
  },
});

export const listQueuedTaskIds = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("tasks")
      .withIndex("by_status_created", (q) => q.eq("status", "queued"))
      .order("asc")
      .take(args.limit ?? 20);

    return docs.map((doc) => doc.taskId);
  },
});

export const listRuntimeTargets = query({
  args: {},
  handler: async () => {
    return [
      {
        id: "local-bun",
        label: "Local JS Runtime",
        description: "Runs generated code in-process using Bun",
      },
      {
        id: "vercel-sandbox",
        label: "Vercel Sandbox Runtime",
        description: "Executes generated code in Vercel Sandbox VMs",
      },
    ];
  },
});

export const getTaskInWorkspace = query({
  args: { taskId: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    const doc = await getTaskDoc(ctx, args.taskId);
    if (!doc || doc.workspaceId !== args.workspaceId) {
      return null;
    }
    return mapTask(doc);
  },
});

export const markTaskRunning = mutation({
  args: { taskId: v.string() },
  handler: async (ctx, args) => {
    const doc = await getTaskDoc(ctx, args.taskId);
    if (!doc || doc.status !== "queued") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(doc._id, {
      status: "running",
      startedAt: doc.startedAt ?? now,
      updatedAt: now,
    });

    const updated = await getTaskDoc(ctx, args.taskId);
    return updated ? mapTask(updated) : null;
  },
});

export const markTaskFinished = mutation({
  args: {
    taskId: v.string(),
    status: v.string(),
    stdout: v.string(),
    stderr: v.string(),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await getTaskDoc(ctx, args.taskId);
    if (!doc) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(doc._id, {
      status: args.status,
      stdout: args.stdout,
      stderr: args.stderr,
      exitCode: args.exitCode,
      error: args.error,
      completedAt: now,
      updatedAt: now,
    });

    const updated = await getTaskDoc(ctx, args.taskId);
    return updated ? mapTask(updated) : null;
  },
});

export const createApproval = mutation({
  args: {
    id: v.string(),
    taskId: v.string(),
    toolPath: v.string(),
    input: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await getApprovalDoc(ctx, args.id);
    if (existing) {
      throw new Error(`Approval already exists: ${args.id}`);
    }

    const task = await getTaskDoc(ctx, args.taskId);
    if (!task) {
      throw new Error(`Task not found for approval: ${args.taskId}`);
    }

    const now = Date.now();
    await ctx.db.insert("approvals", {
      approvalId: args.id,
      taskId: args.taskId,
      workspaceId: task.workspaceId,
      toolPath: args.toolPath,
      input: args.input ?? {},
      status: "pending",
      createdAt: now,
    });

    const created = await getApprovalDoc(ctx, args.id);
    if (!created) {
      throw new Error(`Failed to fetch approval ${args.id}`);
    }
    return mapApproval(created);
  },
});

export const getApproval = query({
  args: { approvalId: v.string() },
  handler: async (ctx, args) => {
    const doc = await getApprovalDoc(ctx, args.approvalId);
    return doc ? mapApproval(doc) : null;
  },
});

export const listApprovals = query({
  args: {
    workspaceId: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      const status = args.status;
      const docs = await ctx.db
        .query("approvals")
        .withIndex("by_workspace_status_created", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("status", status),
        )
        .order("desc")
        .collect();
      return docs.map(mapApproval);
    }

    const docs = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(500);
    return docs.map(mapApproval);
  },
});

export const listPendingApprovals = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status_created", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .order("asc")
      .collect();

    const results: Array<
      ReturnType<typeof mapApproval> & {
        task: { id: string; status: string; runtimeId: string; timeoutMs: number; createdAt: number };
      }
    > = [];
    for (const approval of docs) {
      const task = await getTaskDoc(ctx, approval.taskId);
      if (!task) {
        continue;
      }

      results.push({
        ...mapApproval(approval),
        task: {
          id: task.taskId,
          status: task.status,
          runtimeId: task.runtimeId,
          timeoutMs: task.timeoutMs,
          createdAt: task.createdAt,
        },
      });
    }

    return results;
  },
});

export const resolveApproval = mutation({
  args: {
    approvalId: v.string(),
    decision: v.string(),
    reviewerId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await getApprovalDoc(ctx, args.approvalId);
    if (!doc || doc.status !== "pending") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(doc._id, {
      status: args.decision,
      reason: args.reason,
      reviewerId: args.reviewerId,
      resolvedAt: now,
    });

    const updated = await getApprovalDoc(ctx, args.approvalId);
    return updated ? mapApproval(updated) : null;
  },
});

export const getApprovalInWorkspace = query({
  args: { approvalId: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    const doc = await getApprovalDoc(ctx, args.approvalId);
    if (!doc || doc.workspaceId !== args.workspaceId) {
      return null;
    }
    return mapApproval(doc);
  },
});

// ── Agent Tasks ──

function mapAgentTask(doc: Doc<"agentTasks">) {
  return {
    id: doc.agentTaskId,
    prompt: doc.prompt,
    requesterId: doc.requesterId,
    workspaceId: doc.workspaceId,
    actorId: doc.actorId,
    status: doc.status,
    resultText: doc.resultText,
    error: doc.error,
    codeRuns: doc.codeRuns ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function getAgentTaskDoc(ctx: { db: QueryCtx["db"] }, agentTaskId: string) {
  return await ctx.db
    .query("agentTasks")
    .withIndex("by_agent_task_id", (q) => q.eq("agentTaskId", agentTaskId))
    .unique();
}

export const createAgentTask = mutation({
  args: {
    id: v.string(),
    prompt: v.string(),
    requesterId: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await getAgentTaskDoc(ctx, args.id);
    if (existing) {
      throw new Error(`Agent task already exists: ${args.id}`);
    }

    const now = Date.now();
    await ctx.db.insert("agentTasks", {
      agentTaskId: args.id,
      prompt: args.prompt,
      requesterId: args.requesterId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      status: "running",
      codeRuns: 0,
      createdAt: now,
      updatedAt: now,
    });

    const created = await getAgentTaskDoc(ctx, args.id);
    if (!created) throw new Error(`Failed to fetch created agent task ${args.id}`);
    return mapAgentTask(created);
  },
});

export const getAgentTask = query({
  args: { agentTaskId: v.string() },
  handler: async (ctx, args) => {
    const doc = await getAgentTaskDoc(ctx, args.agentTaskId);
    return doc ? mapAgentTask(doc) : null;
  },
});

export const updateAgentTask = mutation({
  args: {
    agentTaskId: v.string(),
    status: v.optional(v.string()),
    resultText: v.optional(v.string()),
    error: v.optional(v.string()),
    codeRuns: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const doc = await getAgentTaskDoc(ctx, args.agentTaskId);
    if (!doc) return null;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.resultText !== undefined) patch.resultText = args.resultText;
    if (args.error !== undefined) patch.error = args.error;
    if (args.codeRuns !== undefined) patch.codeRuns = args.codeRuns;

    await ctx.db.patch(doc._id, patch);
    const updated = await getAgentTaskDoc(ctx, args.agentTaskId);
    return updated ? mapAgentTask(updated) : null;
  },
});

// Default tools seeded into every new workspace so the editor has
// IntelliSense immediately (before the worker syncs external sources).
const DEFAULT_WORKSPACE_TOOLS = [
  { path: "utils.get_time", description: "Return current server time.", approval: "auto", source: "local" },
  { path: "math.add", description: "Add two numbers.", approval: "auto", source: "local" },
  { path: "admin.send_announcement", description: "Mock announcement sender that requires approval.", approval: "required", source: "local" },
  { path: "admin.delete_data", description: "Mock destructive operation that requires approval.", approval: "required", source: "local" },
  { path: "discover", description: "List all available tools and their descriptions.", approval: "auto", source: "local" },
];

export const bootstrapAnonymousSession = mutation({
  args: { sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.sessionId) {
      const sessionId = args.sessionId;
      const existing = await ctx.db
        .query("anonymousSessions")
        .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { lastSeenAt: now });

        // Ensure the workspace has at least the default tools seeded.
        // This handles existing sessions created before seeding was added.
        const existingTools = await ctx.db
          .query("workspaceTools")
          .withIndex("by_workspace_path", (q: any) => q.eq("workspaceId", existing.workspaceId))
          .first();
        if (!existingTools) {
          for (const tool of DEFAULT_WORKSPACE_TOOLS) {
            await ctx.db.insert("workspaceTools", {
              workspaceId: existing.workspaceId,
              path: tool.path,
              description: tool.description,
              approval: tool.approval,
              source: tool.source,
              updatedAt: now,
            });
          }
        }

        const refreshed = await ctx.db
          .query("anonymousSessions")
          .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
          .unique();
        if (!refreshed) {
          throw new Error("Failed to refresh anonymous session");
        }
        return mapAnonymousContext(refreshed);
      }
    }

    const sessionId = `anon_session_${crypto.randomUUID()}`;
    const workspaceId = `ws_${crypto.randomUUID()}`;
    const actorId = `anon_${crypto.randomUUID()}`;
    const clientId = "web";

    await ctx.db.insert("anonymousSessions", {
      sessionId,
      workspaceId,
      actorId,
      clientId,
      createdAt: now,
      lastSeenAt: now,
    });

    // Seed the workspace with default tools so the editor has IntelliSense
    // immediately. The worker will overwrite these when it syncs external
    // tool sources (if any are added later).
    for (const tool of DEFAULT_WORKSPACE_TOOLS) {
      await ctx.db.insert("workspaceTools", {
        workspaceId,
        path: tool.path,
        description: tool.description,
        approval: tool.approval,
        source: tool.source,
        updatedAt: now,
      });
    }

    const created = await ctx.db
      .query("anonymousSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!created) {
      throw new Error("Failed to create anonymous session");
    }

    return mapAnonymousContext(created);
  },
});

export const upsertAccessPolicy = mutation({
  args: {
    id: v.optional(v.string()),
    workspaceId: v.string(),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    toolPathPattern: v.string(),
    decision: v.string(),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const policyId = args.id ?? `policy_${crypto.randomUUID()}`;
    const existing = await ctx.db
      .query("accessPolicies")
      .withIndex("by_policy_id", (q) => q.eq("policyId", policyId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        workspaceId: args.workspaceId,
        actorId: normalizeOptional(args.actorId),
        clientId: normalizeOptional(args.clientId),
        toolPathPattern: args.toolPathPattern,
        decision: args.decision,
        priority: args.priority ?? 100,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("accessPolicies", {
        policyId,
        workspaceId: args.workspaceId,
        actorId: normalizeOptional(args.actorId),
        clientId: normalizeOptional(args.clientId),
        toolPathPattern: args.toolPathPattern,
        decision: args.decision,
        priority: args.priority ?? 100,
        createdAt: now,
        updatedAt: now,
      });
    }

    const updated = await ctx.db
      .query("accessPolicies")
      .withIndex("by_policy_id", (q) => q.eq("policyId", policyId))
      .unique();
    if (!updated) {
      throw new Error(`Failed to read policy ${policyId}`);
    }
    return mapPolicy(updated);
  },
});

export const listAccessPolicies = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("accessPolicies")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return docs
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt - b.createdAt;
      })
      .map(mapPolicy);
  },
});

export const upsertCredential = mutation({
  args: {
    id: v.optional(v.string()),
    workspaceId: v.string(),
    sourceKey: v.string(),
    scope: v.string(),
    actorId: v.optional(v.string()),
    secretJson: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const actorId = args.scope === "actor" ? normalizeOptional(args.actorId) : "";

    const existing = await ctx.db
      .query("sourceCredentials")
      .withIndex("by_workspace_source_scope_actor", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("sourceKey", args.sourceKey)
          .eq("scope", args.scope)
          .eq("actorId", actorId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        secretJson: asRecord(args.secretJson),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("sourceCredentials", {
        credentialId: args.id ?? `cred_${crypto.randomUUID()}`,
        workspaceId: args.workspaceId,
        sourceKey: args.sourceKey,
        scope: args.scope,
        actorId,
        secretJson: asRecord(args.secretJson),
        createdAt: now,
        updatedAt: now,
      });
    }

    const updated = await ctx.db
      .query("sourceCredentials")
      .withIndex("by_workspace_source_scope_actor", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("sourceKey", args.sourceKey)
          .eq("scope", args.scope)
          .eq("actorId", actorId),
      )
      .unique();

    if (!updated) {
      throw new Error("Failed to read upserted credential");
    }

    return mapCredential(updated);
  },
});

export const listCredentials = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("sourceCredentials")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();
    return docs.map(mapCredential);
  },
});

export const resolveCredential = query({
  args: {
    workspaceId: v.string(),
    sourceKey: v.string(),
    scope: v.string(),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.scope === "actor") {
      const actorId = normalizeOptional(args.actorId);
      if (!actorId) {
        return null;
      }

      const actorDoc = await ctx.db
        .query("sourceCredentials")
        .withIndex("by_workspace_source_scope_actor", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("sourceKey", args.sourceKey)
            .eq("scope", "actor")
            .eq("actorId", actorId),
        )
        .unique();

      return actorDoc ? mapCredential(actorDoc) : null;
    }

    const workspaceDoc = await ctx.db
      .query("sourceCredentials")
      .withIndex("by_workspace_source_scope_actor", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("sourceKey", args.sourceKey)
          .eq("scope", "workspace")
          .eq("actorId", ""),
      )
      .unique();

    return workspaceDoc ? mapCredential(workspaceDoc) : null;
  },
});

export const upsertToolSource = mutation({
  args: {
    id: v.optional(v.string()),
    workspaceId: v.string(),
    name: v.string(),
    type: v.string(),
    config: v.any(),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sourceId = args.id ?? `src_${crypto.randomUUID()}`;
    const existing = await ctx.db
      .query("toolSources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", sourceId))
      .unique();

    const conflict = await ctx.db
      .query("toolSources")
      .withIndex("by_workspace_name", (q) => q.eq("workspaceId", args.workspaceId).eq("name", args.name))
      .unique();

    if (conflict && conflict.sourceId !== sourceId) {
      throw new Error(`Tool source name '${args.name}' already exists in workspace ${args.workspaceId}`);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        workspaceId: args.workspaceId,
        name: args.name,
        type: args.type,
        config: asRecord(args.config),
        enabled: args.enabled !== false,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("toolSources", {
        sourceId,
        workspaceId: args.workspaceId,
        name: args.name,
        type: args.type,
        config: asRecord(args.config),
        enabled: args.enabled !== false,
        createdAt: now,
        updatedAt: now,
      });
    }

    const updated = await ctx.db
      .query("toolSources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", sourceId))
      .unique();
    if (!updated) {
      throw new Error(`Failed to read tool source ${sourceId}`);
    }
    return mapSource(updated);
  },
});

export const listToolSources = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("toolSources")
      .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();
    return docs.map(mapSource);
  },
});

export const listToolSourceWorkspaceUpdates = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("toolSources").collect();
    const byWorkspace = new Map<string, number>();

    for (const doc of docs) {
      const existing = byWorkspace.get(doc.workspaceId) ?? 0;
      if (doc.updatedAt > existing) {
        byWorkspace.set(doc.workspaceId, doc.updatedAt);
      }
    }

    return [...byWorkspace.entries()]
      .map(([workspaceId, updatedAt]) => ({ workspaceId, updatedAt }))
      .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
  },
});

export const syncWorkspaceTools = mutation({
  args: {
    workspaceId: v.string(),
    tools: v.array(
      v.object({
        path: v.string(),
        description: v.string(),
        approval: v.string(),
        source: v.optional(v.string()),
        argsType: v.optional(v.string()),
        returnsType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceTools")
      .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    for (const doc of existing) {
      await ctx.db.delete(doc._id);
    }

    const now = Date.now();
    for (const tool of args.tools) {
      await ctx.db.insert("workspaceTools", {
        workspaceId: args.workspaceId,
        path: tool.path,
        description: tool.description,
        approval: tool.approval,
        source: tool.source,
        argsType: tool.argsType,
        returnsType: tool.returnsType,
        updatedAt: now,
      });
    }

    return true;
  },
});

export const listWorkspaceToolsForContext = query({
  args: {
    workspaceId: v.string(),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [tools, policies] = await Promise.all([
      ctx.db
        .query("workspaceTools")
        .withIndex("by_workspace_path", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
      ctx.db
        .query("accessPolicies")
        .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
    ]);

    return tools
      .map((toolDoc) => {
        const baseDecision = toolDoc.approval === "required" ? "require_approval" : "allow";
        const candidates = policies
          .filter((policy) => {
            const policyActorId = optionalFromNormalized(policy.actorId);
            const policyClientId = optionalFromNormalized(policy.clientId);
            if (policyActorId && policyActorId !== args.actorId) return false;
            if (policyClientId && policyClientId !== args.clientId) return false;
            return matchesToolPath(policy.toolPathPattern, toolDoc.path);
          })
          .sort((a, b) => {
            const bScore = policySpecificity(b, args.actorId, args.clientId);
            const aScore = policySpecificity(a, args.actorId, args.clientId);
            return bScore - aScore;
          });

        const decision = candidates[0]?.decision ?? baseDecision;
        if (decision === "deny") {
          return null;
        }

        const tool = mapWorkspaceTool(toolDoc);
        return {
          ...tool,
          approval: decision === "require_approval" ? "required" : "auto",
        };
      })
      .filter((tool): tool is NonNullable<typeof tool> => tool !== null)
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

export const deleteToolSource = mutation({
  args: { workspaceId: v.string(), sourceId: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("toolSources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .unique();

    if (!doc || doc.workspaceId !== args.workspaceId) {
      return false;
    }

    await ctx.db.delete(doc._id);
    return true;
  },
});

export const createTaskEvent = mutation({
  args: {
    taskId: v.string(),
    eventName: v.string(),
    type: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const task = await getTaskDoc(ctx, args.taskId);
    if (!task) {
      throw new Error(`Task not found for event: ${args.taskId}`);
    }

    const latest = await ctx.db
      .query("taskEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId))
      .order("desc")
      .first();

    const sequence = latest ? latest.sequence + 1 : 1;
    const createdAt = Date.now();

    await ctx.db.insert("taskEvents", {
      sequence,
      taskId: args.taskId,
      eventName: args.eventName,
      type: args.type,
      payload: asRecord(args.payload),
      createdAt,
    });

    const created = await ctx.db
      .query("taskEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId).eq("sequence", sequence))
      .unique();

    if (!created) {
      throw new Error("Failed to read inserted task event");
    }

    return mapTaskEvent(created);
  },
});

export const listTaskEvents = query({
  args: { taskId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("taskEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId))
      .order("asc")
      .collect();

    return docs.map(mapTaskEvent);
  },
});
