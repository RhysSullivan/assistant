// Re-export shared types from contracts
export type {
  TaskStatus,
  ApprovalStatus,
  PolicyDecision,
  CredentialScope,
  ToolApprovalMode,
  ToolSourceType,
  RuntimeId,
  AccessPolicyRecord,
  CredentialRecord,
  ToolDescriptor,
  AnonymousContext,
  McpToolSourceConfig,
  OpenApiToolSourceConfig,
  GraphqlToolSourceConfig,
} from "@executor/contracts";

// ── Web-only types ────────────────────────────────────────────────────────────

import type {
  RuntimeId,
  TaskRecord as SharedTaskRecord,
  ApprovalRecord as SharedApprovalRecord,
  PendingApprovalRecord as SharedPendingApprovalRecord,
  TaskEventRecord as SharedTaskEventRecord,
  TaskStatus,
  ApprovalStatus,
  CredentialScope,
  ToolSourceRecord as SharedToolSourceRecord,
} from "@executor/contracts";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ApprovalDecision = "approved" | "denied";

export type TaskRecord = Omit<SharedTaskRecord, "id" | "workspaceId"> & {
  id: Id<"tasks">;
  workspaceId: Id<"workspaces">;
};

export type ApprovalRecord = Omit<SharedApprovalRecord, "id" | "taskId"> & {
  id: Id<"approvals">;
  taskId: Id<"tasks">;
};

export type PendingApprovalRecord = Omit<SharedPendingApprovalRecord, "id" | "taskId" | "task"> & {
  id: Id<"approvals">;
  taskId: Id<"tasks">;
  task: Omit<SharedPendingApprovalRecord["task"], "id"> & {
    id: Id<"tasks">;
  };
};

export type TaskEventRecord = Omit<SharedTaskEventRecord, "taskId"> & {
  taskId: Id<"tasks">;
};

export interface CreateTaskRequest {
  code: string;
  runtimeId?: RuntimeId;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  workspaceId: Id<"workspaces">;
  actorId: string;
  clientId?: string;
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
}

export interface ResolveApprovalRequest {
  workspaceId: Id<"workspaces">;
  decision: ApprovalDecision;
  reviewerId?: string;
  reason?: string;
}

export interface RuntimeTargetDescriptor {
  id: RuntimeId;
  label: string;
  description: string;
}

export interface CredentialDescriptor {
  id: Id<"sourceCredentials">;
  workspaceId: Id<"workspaces">;
  sourceKey: string;
  scope: CredentialScope;
  actorId?: string;
  hasSecret: boolean;
}

export type ToolSourceRecord = Omit<SharedToolSourceRecord, "id" | "workspaceId"> & {
  id: Id<"toolSources">;
  workspaceId: Id<"workspaces">;
};
