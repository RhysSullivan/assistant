import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const accountProvider = v.union(v.literal("workos"), v.literal("anonymous"));
const accountStatus = v.union(v.literal("active"), v.literal("deleted"));
const organizationStatus = v.union(v.literal("active"), v.literal("deleted"));
const orgRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("billing_admin"));
const orgMemberStatus = v.union(v.literal("active"), v.literal("pending"), v.literal("removed"));
const runtimeTarget = v.literal("local-bun");
const billingSubscriptionStatus = v.union(
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("unpaid"),
  v.literal("paused"),
);
const inviteStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("expired"),
  v.literal("revoked"),
  v.literal("failed"),
);
const taskStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("timed_out"),
  v.literal("denied"),
);
const approvalStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"));
const policyDecision = v.union(v.literal("allow"), v.literal("require_approval"), v.literal("deny"));
const credentialScope = v.union(v.literal("workspace"), v.literal("actor"));
const toolCredentialMode = v.union(v.literal("static"), credentialScope);
const toolSourceType = v.union(v.literal("mcp"), v.literal("openapi"), v.literal("graphql"));
const toolApprovalMode = v.union(v.literal("auto"), v.literal("required"));
const toolSourceApprovalOverride = v.object({
  approval: v.optional(toolApprovalMode),
});
const toolSourceAuth = v.union(
  v.object({
    type: v.literal("none"),
  }),
  v.object({
    type: v.literal("basic"),
    mode: v.optional(toolCredentialMode),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("bearer"),
    mode: v.optional(toolCredentialMode),
    token: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("apiKey"),
    mode: v.optional(toolCredentialMode),
    header: v.string(),
    value: v.optional(v.string()),
  }),
);
const mcpSourceConfig = v.object({
  url: v.string(),
  transport: v.optional(v.union(v.literal("sse"), v.literal("streamable-http"))),
  queryParams: v.optional(v.record(v.string(), v.string())),
  defaultApproval: v.optional(toolApprovalMode),
  overrides: v.optional(v.record(v.string(), toolSourceApprovalOverride)),
});
const openApiSourceConfig = v.object({
  spec: v.union(v.string(), v.record(v.string(), v.any())),
  baseUrl: v.optional(v.string()),
  auth: v.optional(toolSourceAuth),
  defaultReadApproval: v.optional(toolApprovalMode),
  defaultWriteApproval: v.optional(toolApprovalMode),
  overrides: v.optional(v.record(v.string(), toolSourceApprovalOverride)),
});
const graphqlSourceConfig = v.object({
  endpoint: v.string(),
  schema: v.optional(v.record(v.string(), v.any())),
  auth: v.optional(toolSourceAuth),
  defaultQueryApproval: v.optional(toolApprovalMode),
  defaultMutationApproval: v.optional(toolApprovalMode),
  overrides: v.optional(v.record(v.string(), toolSourceApprovalOverride)),
});
const toolSourceConfig = v.union(mcpSourceConfig, openApiSourceConfig, graphqlSourceConfig);
const agentTaskStatus = v.union(v.literal("running"), v.literal("completed"), v.literal("failed"));
const taskEventType = v.union(
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

export default defineSchema({
  accounts: defineTable({
    provider: accountProvider,
    providerAccountId: v.string(),
    email: v.string(),
    name: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    status: accountStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_provider", ["provider", "providerAccountId"])
    .index("by_email", ["email"]),

  workspaces: defineTable({
    organizationId: v.id("organizations"),
    slug: v.string(),
    name: v.string(),
    iconStorageId: v.optional(v.id("_storage")),
    createdByAccountId: v.optional(v.id("accounts")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_organization_slug", ["organizationId", "slug"])
    .index("by_creator_created", ["createdByAccountId", "createdAt"])
    .index("by_slug", ["slug"]),

  organizations: defineTable({
    workosOrgId: v.optional(v.string()),
    slug: v.string(),
    name: v.string(),
    status: organizationStatus,
    createdByAccountId: v.optional(v.id("accounts")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workos_org_id", ["workosOrgId"])
    .index("by_slug", ["slug"])
    .index("by_status_created", ["status", "createdAt"]),

  organizationMembers: defineTable({
    organizationId: v.id("organizations"),
    accountId: v.id("accounts"),
    workosOrgMembershipId: v.optional(v.string()),
    role: orgRole,
    status: orgMemberStatus,
    billable: v.boolean(),
    invitedByAccountId: v.optional(v.id("accounts")),
    joinedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_account", ["organizationId", "accountId"])
    .index("by_workos_membership_id", ["workosOrgMembershipId"])
    .index("by_account", ["accountId"])
    .index("by_org_status", ["organizationId", "status"])
    .index("by_org_billable_status", ["organizationId", "billable", "status"]),

  invites: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: orgRole,
    status: inviteStatus,
    providerInviteId: v.optional(v.string()),
    invitedByAccountId: v.id("accounts"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_status_created", ["organizationId", "status", "createdAt"])
    .index("by_org_email_status", ["organizationId", "email", "status"]),

  billingCustomers: defineTable({
    organizationId: v.id("organizations"),
    stripeCustomerId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_stripe_customer_id", ["stripeCustomerId"]),

  billingSubscriptions: defineTable({
    organizationId: v.id("organizations"),
    stripeSubscriptionId: v.string(),
    stripePriceId: v.string(),
    status: billingSubscriptionStatus,
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    canceledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_status", ["organizationId", "status"])
    .index("by_stripe_subscription_id", ["stripeSubscriptionId"]),

  billingSeatState: defineTable({
    organizationId: v.id("organizations"),
    desiredSeats: v.number(),
    lastAppliedSeats: v.optional(v.number()),
    syncVersion: v.number(),
    lastSyncAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_org", ["organizationId"]),

  tasks: defineTable({
    code: v.string(),
    runtimeId: runtimeTarget,
    workspaceId: v.id("workspaces"),
    actorId: v.string(),
    clientId: v.string(),
    status: taskStatus,
    timeoutMs: v.number(),
    metadata: v.record(v.string(), v.any()),
    error: v.optional(v.string()),
    stdout: v.optional(v.string()),
    stderr: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_status_created", ["status", "createdAt"]),

  approvals: defineTable({
    taskId: v.id("tasks"),
    workspaceId: v.id("workspaces"),
    toolPath: v.string(),
    input: v.record(v.string(), v.any()),
    status: approvalStatus,
    reason: v.optional(v.string()),
    reviewerId: v.optional(v.string()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_task", ["taskId"])
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_workspace_status_created", ["workspaceId", "status", "createdAt"]),

  taskEvents: defineTable({
    sequence: v.number(),
    taskId: v.id("tasks"),
    type: taskEventType,
    payload: v.record(v.string(), v.any()),
    createdAt: v.number(),
  })
    .index("by_sequence", ["sequence"])
    .index("by_task_sequence", ["taskId", "sequence"]),

  accessPolicies: defineTable({
    workspaceId: v.id("workspaces"),
    actorId: v.string(),
    clientId: v.string(),
    toolPathPattern: v.string(),
    decision: policyDecision,
    priority: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_created", ["workspaceId", "createdAt"]),

  sourceCredentials: defineTable({
    workspaceId: v.id("workspaces"),
    sourceKey: v.string(),
    scope: credentialScope,
    actorId: v.string(),
    secretJson: v.record(v.string(), v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_workspace_source_scope_actor", ["workspaceId", "sourceKey", "scope", "actorId"]),

  toolSources: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    type: toolSourceType,
    config: toolSourceConfig,
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .index("by_workspace_name", ["workspaceId", "name"])
    .index("by_workspace_enabled_updated", ["workspaceId", "enabled", "updatedAt"]),

  agentTasks: defineTable({
    prompt: v.string(),
    requesterId: v.string(),
    workspaceId: v.id("workspaces"),
    actorId: v.string(),
    status: agentTaskStatus,
    resultText: v.optional(v.string()),
    error: v.optional(v.string()),
    codeRuns: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_requester_created", ["requesterId", "createdAt"]),

  anonymousSessions: defineTable({
    sessionId: v.string(),
    workspaceId: v.id("workspaces"),
    actorId: v.string(),
    clientId: v.string(),
    accountId: v.optional(v.id("accounts")),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_workspace_actor", ["workspaceId", "actorId"])
    .index("by_account", ["accountId"]),
});
