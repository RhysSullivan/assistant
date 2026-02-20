import type { Id } from "@/lib/convex-id";

// ── Shared types (inlined from @executor/contracts) ──────────────────────────

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "timed_out" | "denied";
export type ApprovalStatus = "pending" | "approved" | "denied";
export type PolicyDecision = "allow" | "require_approval" | "deny";
export type PolicyScopeType = "account" | "organization" | "workspace";
export type PolicyMatchType = "glob" | "exact";
export type PolicyEffect = "allow" | "deny";
export type PolicyApprovalMode = "inherit" | "auto" | "required";
export type ToolRoleSelectorType = "all" | "source" | "namespace" | "tool_path";
export type ToolRoleBindingStatus = "active" | "disabled";
export type ArgumentConditionOperator = "equals" | "contains" | "starts_with" | "not_equals";

export interface ArgumentCondition {
  key: string;
  operator: ArgumentConditionOperator;
  value: string;
}

export interface CredentialAdditionalHeader {
  name: string;
  value: string;
}

export type CredentialScopeType = "account" | "organization" | "workspace";
export type CredentialScope = CredentialScopeType;
export type CredentialProvider = "local-convex" | "workos-vault";
export type ToolSourceScopeType = "organization" | "workspace";
export type ToolApprovalMode = "auto" | "required";
export type ToolSourceType = "mcp" | "openapi" | "graphql";
export type StorageScopeType = "scratch" | "account" | "workspace" | "organization";
export type StorageDurability = "ephemeral" | "durable";
export type StorageInstanceStatus = "active" | "closed" | "deleted";
export type StorageProvider = "agentfs-local" | "agentfs-cloudflare";

export type SourceAuthType = "none" | "bearer" | "apiKey" | "basic" | "mixed";

export interface SourceAuthProfile {
  type: SourceAuthType;
  mode?: CredentialScope;
  header?: string;
  inferred: boolean;
}

export interface TaskRecord {
  id: string;
  code: string;
  runtimeId: string;
  status: TaskStatus;
  timeoutMs: number;
  metadata: Record<string, unknown>;
  workspaceId: string;
  accountId?: Id<"accounts">;
  clientId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: unknown;
  exitCode?: number;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  toolPath: string;
  input: unknown;
  status: ApprovalStatus;
  reason?: string;
  reviewerId?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface PendingApprovalRecord extends ApprovalRecord {
  task: Pick<TaskRecord, "id" | "status" | "runtimeId" | "timeoutMs" | "createdAt">;
}

export interface TaskEventRecord {
  id: number;
  taskId: string;
  eventName: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

export type PolicyResourceType = "all_tools" | "source" | "namespace" | "tool_path";

export interface ToolPolicyRecord {
  id: string;
  scopeType: PolicyScopeType;
  organizationId: Id<"organizations">;
  workspaceId?: Id<"workspaces">;
  targetAccountId?: Id<"accounts">;
  clientId?: string;
  resourceType: PolicyResourceType;
  resourcePattern: string;
  matchType: PolicyMatchType;
  effect: PolicyEffect;
  approvalMode: PolicyApprovalMode;
  argumentConditions?: ArgumentCondition[];
  priority: number;
  roleId?: string;
  ruleId?: string;
  bindingId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ToolPolicySetRecord {
  id: string;
  organizationId: Id<"organizations">;
  name: string;
  description?: string;
  createdByAccountId?: Id<"accounts">;
  createdAt: number;
  updatedAt: number;
}

export interface ToolPolicyRuleRecord {
  id: string;
  roleId: string;
  organizationId: Id<"organizations">;
  selectorType: ToolRoleSelectorType;
  sourceKey?: string;
  namespacePattern?: string;
  toolPathPattern?: string;
  matchType: PolicyMatchType;
  effect: PolicyEffect;
  approvalMode: PolicyApprovalMode;
  argumentConditions?: ArgumentCondition[];
  priority: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolPolicyAssignmentRecord {
  id: string;
  roleId: string;
  organizationId: Id<"organizations">;
  scopeType: PolicyScopeType;
  workspaceId?: Id<"workspaces">;
  targetAccountId?: Id<"accounts">;
  clientId?: string;
  status: ToolRoleBindingStatus;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialRecord {
  id: string;
  bindingId?: string;
  scopeType: CredentialScopeType;
  accountId?: Id<"accounts">;
  organizationId?: string;
  workspaceId?: string;
  sourceKey: string;
  additionalHeaders: CredentialAdditionalHeader[];
  boundAuthFingerprint?: string;
  provider: CredentialProvider;
  secretJson: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ToolSourceRecord {
  id: string;
  scopeType: ToolSourceScopeType;
  organizationId?: string;
  workspaceId?: string;
  name: string;
  type: ToolSourceType;
  configVersion: number;
  config: Record<string, unknown>;
  specHash?: string;
  authFingerprint?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StorageInstanceRecord {
  id: string;
  scopeType: StorageScopeType;
  durability: StorageDurability;
  status: StorageInstanceStatus;
  provider: StorageProvider;
  backendKey: string;
  organizationId: string;
  workspaceId?: string;
  accountId?: string;
  createdByAccountId?: string;
  purpose?: string;
  sizeBytes?: number;
  fileCount?: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  closedAt?: number;
  expiresAt?: number;
}

export interface ToolDescriptor {
  path: string;
  description: string;
  approval: ToolApprovalMode;
  source?: string;
  typing?: {
    requiredInputKeys?: string[];
    previewInputKeys?: string[];
    refHintKeys?: string[];
    refHints?: Record<string, string>;
    inputSchemaJson?: string;
    outputSchemaJson?: string;
    typedRef?: {
      kind: "openapi_operation";
      sourceKey: string;
      operationId: string;
    };
  };
  display?: {
    input?: string;
    output?: string;
  };
}

export interface OpenApiSourceQuality {
  sourceKey: string;
  toolCount: number;
  unknownArgsCount: number;
  unknownReturnsCount: number;
  partialUnknownArgsCount: number;
  partialUnknownReturnsCount: number;
  argsQuality: number;
  returnsQuality: number;
  overallQuality: number;
}

export interface AnonymousContext {
  sessionId: string;
  workspaceId: Id<"workspaces">;
  clientId: string;
  accountId: Id<"accounts">;
  createdAt: number;
  lastSeenAt: number;
}

// ── Web-only types ────────────────────────────────────────────────────────────

export type ApprovalDecision = "approved" | "denied";

export interface CreateTaskRequest {
  code: string;
  runtimeId?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  workspaceId: string;
  accountId: string;
  clientId?: string;
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
}

export interface ResolveApprovalRequest {
  workspaceId: string;
  decision: ApprovalDecision;
  reviewerId?: string;
  reason?: string;
}

export interface RuntimeTargetDescriptor {
  id: string;
  label: string;
  description: string;
}

export interface CredentialDescriptor {
  id: string;
  workspaceId: string;
  sourceKey: string;
  scope: CredentialScopeType;
  hasSecret: boolean;
}
