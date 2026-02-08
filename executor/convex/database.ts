import { v } from "convex/values";
import { getAll, getOneFrom } from "convex-helpers/server/relationships";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { ensureUniqueSlug } from "./lib/slug";

const DEFAULT_TIMEOUT_MS = 15_000;
type OrganizationRole = "owner" | "admin" | "member" | "billing_admin";
type OrganizationMemberStatus = "active" | "pending" | "removed";

const completedTaskStatusValidator = v.union(
  v.literal("completed"),
  v.literal("failed"),
  v.literal("timed_out"),
  v.literal("denied"),
);
const approvalStatusValidator = v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"));
const policyDecisionValidator = v.union(v.literal("allow"), v.literal("require_approval"), v.literal("deny"));
const credentialScopeValidator = v.union(v.literal("workspace"), v.literal("actor"));
const toolSourceTypeValidator = v.union(v.literal("mcp"), v.literal("openapi"), v.literal("graphql"));
const toolApprovalModeValidator = v.union(v.literal("auto"), v.literal("required"));
const toolCredentialModeValidator = v.union(v.literal("static"), credentialScopeValidator);
const toolSourceApprovalOverrideValidator = v.object({ approval: v.optional(toolApprovalModeValidator) });
const toolSourceAuthValidator = v.union(
  v.object({ type: v.literal("none") }),
  v.object({
    type: v.literal("basic"),
    mode: v.optional(toolCredentialModeValidator),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("bearer"),
    mode: v.optional(toolCredentialModeValidator),
    token: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("apiKey"),
    mode: v.optional(toolCredentialModeValidator),
    header: v.string(),
    value: v.optional(v.string()),
  }),
);
const mcpSourceConfigValidator = v.object({
  url: v.string(),
  transport: v.optional(v.union(v.literal("sse"), v.literal("streamable-http"))),
  queryParams: v.optional(v.record(v.string(), v.string())),
  defaultApproval: v.optional(toolApprovalModeValidator),
  overrides: v.optional(v.record(v.string(), toolSourceApprovalOverrideValidator)),
});
const openApiSourceConfigValidator = v.object({
  spec: v.union(v.string(), v.record(v.string(), v.any())),
  baseUrl: v.optional(v.string()),
  auth: v.optional(toolSourceAuthValidator),
  defaultReadApproval: v.optional(toolApprovalModeValidator),
  defaultWriteApproval: v.optional(toolApprovalModeValidator),
  overrides: v.optional(v.record(v.string(), toolSourceApprovalOverrideValidator)),
});
const graphqlSourceConfigValidator = v.object({
  endpoint: v.string(),
  schema: v.optional(v.record(v.string(), v.any())),
  auth: v.optional(toolSourceAuthValidator),
  defaultQueryApproval: v.optional(toolApprovalModeValidator),
  defaultMutationApproval: v.optional(toolApprovalModeValidator),
  overrides: v.optional(v.record(v.string(), toolSourceApprovalOverrideValidator)),
});
const toolSourceConfigValidator = v.union(
  mcpSourceConfigValidator,
  openApiSourceConfigValidator,
  graphqlSourceConfigValidator,
);
const agentTaskStatusValidator = v.union(v.literal("running"), v.literal("completed"), v.literal("failed"));
const runtimeTargetValidator = v.literal("local-bun");
const taskEventTypeValidator = v.union(
  v.literal("task.created"),
  v.literal("task.queued"),
  v.literal("task.running"),
  v.literal("task.completed"),
  v.literal("task.failed"),
  v.literal("task.timed_out"),
  v.literal("task.denied"),
  v.literal("task.stdout"),
  v.literal("task.stderr"),
  v.literal("tool.call.started"),
  v.literal("tool.call.completed"),
  v.literal("tool.call.failed"),
  v.literal("tool.call.denied"),
  v.literal("approval.requested"),
  v.literal("approval.resolved"),
);

function taskEventNameFromType(type: string): "task" | "approval" {
  return type.startsWith("approval.") ? "approval" : "task";
}

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

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "workspace";
}

async function ensureUniqueOrganizationSlug(ctx: Pick<MutationCtx, "db">, baseName: string): Promise<string> {
  const baseSlug = slugify(baseName);
  return await ensureUniqueSlug(baseSlug, async (candidate) => {
    const collision = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .unique();
    return collision !== null;
  });
}

async function upsertOrganizationMembership(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Doc<"organizations">["_id"];
    accountId: Doc<"accounts">["_id"];
    role: OrganizationRole;
    status: OrganizationMemberStatus;
    billable: boolean;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("organizationMembers")
    .withIndex("by_org_account", (q) => q.eq("organizationId", args.organizationId).eq("accountId", args.accountId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      role: args.role,
      status: args.status,
      billable: args.billable,
      joinedAt: args.status === "active" ? (existing.joinedAt ?? args.now) : existing.joinedAt,
      updatedAt: args.now,
    });
    return;
  }

  await ctx.db.insert("organizationMembers", {
    organizationId: args.organizationId,
    accountId: args.accountId,
    role: args.role,
    status: args.status,
    billable: args.billable,
    joinedAt: args.status === "active" ? args.now : undefined,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

// NOTE: Canonical version lives in convex/lib/utils.ts.
// Convex can't import from the server, so this is a local copy.
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeToolSourceConfig(
  type: Doc<"toolSources">["type"],
  config: Doc<"toolSources">["config"],
): Doc<"toolSources">["config"] {
  if (type === "mcp") {
    if (!("url" in config) || typeof config.url !== "string" || config.url.trim().length === 0) {
      throw new Error("MCP source config must include a non-empty url");
    }
    return config;
  }

  if (type === "openapi") {
    if (!("spec" in config)) {
      throw new Error("OpenAPI source config must include spec");
    }
    const spec = config.spec;
    if (typeof spec !== "string" && (typeof spec !== "object" || spec === null || Array.isArray(spec))) {
      throw new Error("OpenAPI source config must include spec");
    }
    return config;
  }

  if (!("endpoint" in config) || typeof config.endpoint !== "string" || config.endpoint.trim().length === 0) {
    throw new Error("GraphQL source config must include a non-empty endpoint");
  }
  return config;
}

function mapTask(doc: Doc<"tasks">) {
  return {
    id: doc._id,
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
    id: doc._id,
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
    id: doc._id,
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
    id: doc._id,
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
    id: doc._id,
    workspaceId: doc.workspaceId,
    name: doc.name,
    type: doc.type,
    config: doc.config,
    enabled: Boolean(doc.enabled),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function ensureAnonymousIdentity(
  ctx: MutationCtx,
  params: {
    sessionId: string;
    workspaceId?: Doc<"workspaces">["_id"];
    actorId: string;
    timestamp: number;
  },
) {
  const now = params.timestamp;

  let account = await ctx.db
    .query("accounts")
    .withIndex("by_provider", (q) => q.eq("provider", "anonymous").eq("providerAccountId", params.actorId))
    .unique();

  if (!account) {
    const accountId = await ctx.db.insert("accounts", {
      provider: "anonymous",
      providerAccountId: params.actorId,
      email: `${params.actorId}@guest.executor.local`,
      name: "Guest User",
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    account = await ctx.db.get(accountId);
    if (!account) {
      throw new Error("Failed to create anonymous account");
    }
  } else {
    await ctx.db.patch(account._id, { updatedAt: now, lastLoginAt: now });
  }

  let workspace = params.workspaceId ? await ctx.db.get(params.workspaceId) : null;

  let organizationId: Doc<"organizations">["_id"];

  if (!workspace) {
    const organizationSlug = await ensureUniqueOrganizationSlug(ctx, "Guest Workspace");
    organizationId = await ctx.db.insert("organizations", {
      slug: organizationSlug,
      name: "Guest Workspace",
      status: "active",
      createdByAccountId: account._id,
      createdAt: now,
      updatedAt: now,
    });

    const workspaceId = await ctx.db.insert("workspaces", {
      organizationId,
      slug: `guest-${crypto.randomUUID().slice(0, 8)}`,
      name: "Guest Workspace",
      createdByAccountId: account._id,
      createdAt: now,
      updatedAt: now,
    });
    workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new Error("Failed to create anonymous workspace");
    }
  } else {
    organizationId = workspace.organizationId;
  }

  await upsertOrganizationMembership(ctx, {
    organizationId,
    accountId: account._id,
    role: "owner",
    status: "active",
    billable: true,
    now,
  });

  return {
    accountId: account._id,
    workspaceId: workspace._id,
  };
}

function mapAnonymousContext(doc: Doc<"anonymousSessions">) {
  return {
    sessionId: doc.sessionId,
    workspaceId: doc.workspaceId,
    actorId: doc.actorId,
    clientId: doc.clientId,
    accountId: doc.accountId,
    createdAt: doc.createdAt,
    lastSeenAt: doc.lastSeenAt,
  };
}

function mapTaskEvent(doc: Doc<"taskEvents">) {
  return {
    id: doc.sequence,
    taskId: doc.taskId,
    eventName: taskEventNameFromType(doc.type),
    type: doc.type,
    payload: doc.payload,
    createdAt: doc.createdAt,
  };
}

async function getTaskDoc(ctx: { db: QueryCtx["db"] }, taskId: Id<"tasks">) {
  return await ctx.db.get(taskId);
}

async function getApprovalDoc(ctx: { db: QueryCtx["db"] }, approvalId: Id<"approvals">) {
  return await ctx.db.get(approvalId);
}

export const createTask = mutation({
  args: {
    code: v.string(),
    runtimeId: runtimeTargetValidator,
    timeoutMs: v.optional(v.number()),
    metadata: v.optional(v.record(v.string(), v.any())),
    workspaceId: v.id("workspaces"),
    actorId: v.string(),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
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

    const created = await getTaskDoc(ctx, taskId);
    if (!created) {
      throw new Error(`Failed to fetch created task ${taskId}`);
    }
    return mapTask(created);
  },
});

export const getTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const doc = await getTaskDoc(ctx, args.taskId);
    return doc ? mapTask(doc) : null;
  },
});

export const listTasks = query({
  args: { workspaceId: v.id("workspaces") },
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

    return docs.map((doc) => doc._id);
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
    ];
  },
});

export const getTaskInWorkspace = query({
  args: { taskId: v.id("tasks"), workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const doc = await getTaskDoc(ctx, args.taskId);
    if (!doc || doc.workspaceId !== args.workspaceId) {
      return null;
    }
    return mapTask(doc);
  },
});

export const markTaskRunning = mutation({
  args: { taskId: v.id("tasks") },
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
    taskId: v.id("tasks"),
    status: completedTaskStatusValidator,
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
    taskId: v.id("tasks"),
    toolPath: v.string(),
    input: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const task = await getTaskDoc(ctx, args.taskId);
    if (!task) {
      throw new Error(`Task not found for approval: ${args.taskId}`);
    }

    const now = Date.now();
    const approvalId = await ctx.db.insert("approvals", {
      taskId: args.taskId,
      workspaceId: task.workspaceId,
      toolPath: args.toolPath,
      input: args.input ?? {},
      status: "pending",
      createdAt: now,
    });

    const created = await getApprovalDoc(ctx, approvalId);
    if (!created) {
      throw new Error(`Failed to fetch approval ${approvalId}`);
    }
    return mapApproval(created);
  },
});

export const getApproval = query({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, args) => {
    const doc = await getApprovalDoc(ctx, args.approvalId);
    return doc ? mapApproval(doc) : null;
  },
});

export const listApprovals = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(approvalStatusValidator),
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
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status_created", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .order("asc")
      .collect();

    const tasks = await getAll(ctx.db, docs.map((approval) => approval.taskId));

    const results: Array<
      ReturnType<typeof mapApproval> & {
        task: { id: string; status: string; runtimeId: "local-bun"; timeoutMs: number; createdAt: number };
      }
    > = [];
    for (let i = 0; i < docs.length; i++) {
      const approval = docs[i]!;
      const task = tasks[i];
      if (!task) {
        continue;
      }

      results.push({
        ...mapApproval(approval),
        task: {
          id: task._id,
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
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approved"), v.literal("denied")),
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
  args: { approvalId: v.id("approvals"), workspaceId: v.id("workspaces") },
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
    id: doc._id,
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

export const createAgentTask = mutation({
  args: {
    prompt: v.string(),
    requesterId: v.string(),
    workspaceId: v.id("workspaces"),
    actorId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const agentTaskId = await ctx.db.insert("agentTasks", {
      prompt: args.prompt,
      requesterId: args.requesterId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      status: "running",
      codeRuns: 0,
      createdAt: now,
      updatedAt: now,
    });

    const created = await ctx.db.get(agentTaskId);
    if (!created) throw new Error(`Failed to fetch created agent task ${agentTaskId}`);
    return mapAgentTask(created);
  },
});

export const getAgentTask = query({
  args: { agentTaskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.agentTaskId);
    return doc ? mapAgentTask(doc) : null;
  },
});

export const updateAgentTask = mutation({
  args: {
    agentTaskId: v.id("agentTasks"),
    status: v.optional(agentTaskStatusValidator),
    resultText: v.optional(v.string()),
    error: v.optional(v.string()),
    codeRuns: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.agentTaskId);
    if (!doc) return null;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.resultText !== undefined) patch.resultText = args.resultText;
    if (args.error !== undefined) patch.error = args.error;
    if (args.codeRuns !== undefined) patch.codeRuns = args.codeRuns;

    await ctx.db.patch(doc._id, patch);
    const updated = await ctx.db.get(args.agentTaskId);
    return updated ? mapAgentTask(updated) : null;
  },
});

export const bootstrapAnonymousSession = mutation({
  args: { sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requestedSessionId = normalizeOptional(args.sessionId);

    if (requestedSessionId) {
      const sessionId = requestedSessionId;
      const existing = await getOneFrom(ctx.db, "anonymousSessions", "by_session_id", sessionId, "sessionId");
      if (existing) {
        const identity = await ensureAnonymousIdentity(ctx, {
          sessionId,
          workspaceId: existing.workspaceId,
          actorId: existing.actorId,
          timestamp: now,
        });

        await ctx.db.patch(existing._id, {
          workspaceId: identity.workspaceId,
          accountId: identity.accountId,
          lastSeenAt: now,
        });

        const refreshed = await getOneFrom(ctx.db, "anonymousSessions", "by_session_id", sessionId, "sessionId");
        if (!refreshed) {
          throw new Error("Failed to refresh anonymous session");
        }
        return mapAnonymousContext(refreshed);
      }
    }

    const sessionId = requestedSessionId || `anon_session_${crypto.randomUUID()}`;
    const actorId = `anon_${crypto.randomUUID()}`;
    const clientId = "web";

    const identity = await ensureAnonymousIdentity(ctx, {
      sessionId,
      actorId,
      timestamp: now,
    });

    await ctx.db.insert("anonymousSessions", {
      sessionId,
      workspaceId: identity.workspaceId,
      actorId,
      clientId,
      accountId: identity.accountId,
      createdAt: now,
      lastSeenAt: now,
    });

    const created = await getOneFrom(ctx.db, "anonymousSessions", "by_session_id", sessionId, "sessionId");
    if (!created) {
      throw new Error("Failed to create anonymous session");
    }

    return mapAnonymousContext(created);
  },
});

export const upsertAccessPolicy = mutation({
  args: {
    id: v.optional(v.id("accessPolicies")),
    workspaceId: v.id("workspaces"),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    toolPathPattern: v.string(),
    decision: policyDecisionValidator,
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = args.id ? await ctx.db.get(args.id) : null;

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
      const insertedId = await ctx.db.insert("accessPolicies", {
        workspaceId: args.workspaceId,
        actorId: normalizeOptional(args.actorId),
        clientId: normalizeOptional(args.clientId),
        toolPathPattern: args.toolPathPattern,
        decision: args.decision,
        priority: args.priority ?? 100,
        createdAt: now,
        updatedAt: now,
      });

      const inserted = await ctx.db.get(insertedId);
      if (!inserted) {
        throw new Error(`Failed to read policy ${insertedId}`);
      }
      return mapPolicy(inserted);
    }

    const updated = await ctx.db.get(existing._id);
    if (!updated) {
      throw new Error(`Failed to read policy ${existing._id}`);
    }
    return mapPolicy(updated);
  },
});

export const listAccessPolicies = query({
  args: { workspaceId: v.id("workspaces") },
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
    workspaceId: v.id("workspaces"),
    sourceKey: v.string(),
    scope: credentialScopeValidator,
    actorId: v.optional(v.string()),
    secretJson: v.record(v.string(), v.any()),
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
  args: { workspaceId: v.id("workspaces") },
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
    workspaceId: v.id("workspaces"),
    sourceKey: v.string(),
    scope: credentialScopeValidator,
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
    id: v.optional(v.id("toolSources")),
    workspaceId: v.id("workspaces"),
    name: v.string(),
    type: toolSourceTypeValidator,
    config: toolSourceConfigValidator,
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const config = normalizeToolSourceConfig(args.type, args.config);
    const [existing, conflict] = await Promise.all([
      args.id ? ctx.db.get(args.id) : Promise.resolve(null),
      ctx.db
        .query("toolSources")
        .withIndex("by_workspace_name", (q) => q.eq("workspaceId", args.workspaceId).eq("name", args.name))
        .unique(),
    ]);

    if (conflict && (!existing || conflict._id !== existing._id)) {
      throw new Error(`Tool source name '${args.name}' already exists in workspace ${args.workspaceId}`);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        workspaceId: args.workspaceId,
        name: args.name,
        type: args.type,
        config,
        enabled: args.enabled !== false,
        updatedAt: now,
      });
      const updated = await ctx.db.get(existing._id);
      if (!updated) {
        throw new Error(`Failed to read tool source ${existing._id}`);
      }
      return mapSource(updated);
    } else {
      const insertedId = await ctx.db.insert("toolSources", {
        workspaceId: args.workspaceId,
        name: args.name,
        type: args.type,
        config,
        enabled: args.enabled !== false,
        createdAt: now,
        updatedAt: now,
      });
      const updated = await ctx.db.get(insertedId);
      if (!updated) {
        throw new Error(`Failed to read tool source ${insertedId}`);
      }
      return mapSource(updated);
    }
  },
});

export const listToolSources = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("toolSources")
      .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();
    return docs.map(mapSource);
  },
});

export const deleteToolSource = mutation({
  args: { workspaceId: v.id("workspaces"), sourceId: v.id("toolSources") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.sourceId);

    if (!doc || doc.workspaceId !== args.workspaceId) {
      return false;
    }

    await ctx.db.delete(args.sourceId);
    return true;
  },
});

export const createTaskEvent = mutation({
  args: {
    taskId: v.id("tasks"),
    type: taskEventTypeValidator,
    payload: v.record(v.string(), v.any()),
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
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("taskEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId))
      .order("asc")
      .collect();

    return docs.map(mapTaskEvent);
  },
});
