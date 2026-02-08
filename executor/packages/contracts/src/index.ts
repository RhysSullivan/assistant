// ── Status enums ──────────────────────────────────────────────────────────────

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "denied";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type PolicyDecision = "allow" | "require_approval" | "deny";

export type CredentialScope = "workspace" | "actor";

export type ToolApprovalMode = "auto" | "required";

export type ToolSourceType = "mcp" | "openapi" | "graphql";

export type RuntimeId = "local-bun";

export type TaskEventName = "task" | "approval";

export type TaskEventType =
  | "task.created"
  | "task.queued"
  | "task.running"
  | "task.completed"
  | "task.failed"
  | "task.timed_out"
  | "task.denied"
  | "task.stdout"
  | "task.stderr"
  | "tool.call.started"
  | "tool.call.completed"
  | "tool.call.failed"
  | "tool.call.denied"
  | "approval.requested"
  | "approval.resolved";

export type TaskEventNameForType<T extends TaskEventType> =
  T extends `approval.${string}` ? "approval" : "task";

export interface TaskCreatedEventPayload {
  taskId: string;
  status: TaskStatus;
  runtimeId: RuntimeId;
  timeoutMs: number;
  workspaceId: string;
  actorId?: string;
  clientId?: string;
  createdAt: number;
}

export interface TaskQueuedEventPayload {
  taskId: string;
  status: "queued";
}

export interface TaskRunningEventPayload {
  taskId: string;
  status: "running";
  startedAt?: number;
}

export interface TaskTerminalEventPayload {
  taskId: string;
  status: Extract<TaskStatus, "completed" | "failed" | "timed_out" | "denied">;
  exitCode?: number;
  durationMs?: number;
  error?: string;
  completedAt?: number;
}

export interface TaskOutputEventPayload {
  taskId: string;
  line: string;
  timestamp: number;
}

export interface ToolCallStartedEventPayload {
  taskId: string;
  callId: string;
  toolPath: string;
  approval: ToolApprovalMode;
  input: Record<string, unknown>;
}

export interface ToolCallCompletedEventPayload {
  taskId: string;
  callId: string;
  toolPath: string;
  output: Record<string, unknown>;
}

export interface ToolCallFailedEventPayload {
  taskId: string;
  callId: string;
  toolPath: string;
  error: string;
}

export interface ToolCallDeniedEventPayload {
  taskId: string;
  callId: string;
  toolPath: string;
  reason?: string;
  approvalId?: string;
}

export interface ApprovalRequestedEventPayload {
  approvalId: string;
  taskId: string;
  callId: string;
  toolPath: string;
  input: Record<string, unknown>;
  createdAt: number;
}

export interface ApprovalResolvedEventPayload {
  approvalId: string;
  taskId: string;
  toolPath: string;
  decision: Extract<ApprovalStatus, "approved" | "denied">;
  reviewerId?: string;
  reason?: string;
  resolvedAt?: number;
}

export interface TaskEventPayloadByType {
  "task.created": TaskCreatedEventPayload;
  "task.queued": TaskQueuedEventPayload;
  "task.running": TaskRunningEventPayload;
  "task.completed": TaskTerminalEventPayload;
  "task.failed": TaskTerminalEventPayload;
  "task.timed_out": TaskTerminalEventPayload;
  "task.denied": TaskTerminalEventPayload;
  "task.stdout": TaskOutputEventPayload;
  "task.stderr": TaskOutputEventPayload;
  "tool.call.started": ToolCallStartedEventPayload;
  "tool.call.completed": ToolCallCompletedEventPayload;
  "tool.call.failed": ToolCallFailedEventPayload;
  "tool.call.denied": ToolCallDeniedEventPayload;
  "approval.requested": ApprovalRequestedEventPayload;
  "approval.resolved": ApprovalResolvedEventPayload;
}

// ── Records ───────────────────────────────────────────────────────────────────

export interface TaskRecord {
  id: string;
  code: string;
  runtimeId: RuntimeId;
  status: TaskStatus;
  timeoutMs: number;
  metadata: Record<string, unknown>;
  workspaceId: string;
  actorId?: string;
  clientId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
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

export type TaskEventRecord = {
  id: number;
  taskId: string;
  createdAt: number;
} & {
  [K in TaskEventType]: {
    eventName: TaskEventNameForType<K>;
    type: K;
    payload: TaskEventPayloadByType[K];
  };
}[TaskEventType];

export interface AccessPolicyRecord {
  id: string;
  workspaceId: string;
  actorId?: string;
  clientId?: string;
  toolPathPattern: string;
  decision: PolicyDecision;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialRecord {
  id: string;
  workspaceId: string;
  sourceKey: string;
  scope: CredentialScope;
  actorId?: string;
  secretJson: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type ToolSourceCredentialMode = "static" | CredentialScope;

export type ToolSourceAuth =
  | { type: "none" }
  | {
    type: "basic";
    mode?: ToolSourceCredentialMode;
    username?: string;
    password?: string;
  }
  | {
    type: "bearer";
    mode?: ToolSourceCredentialMode;
    token?: string;
  }
  | {
    type: "apiKey";
    mode?: ToolSourceCredentialMode;
    header: string;
    value?: string;
  };

export interface ToolSourceApprovalOverride {
  approval?: ToolApprovalMode;
}

export interface McpToolSourceConfig {
  url: string;
  transport?: "sse" | "streamable-http";
  queryParams?: Record<string, string>;
  defaultApproval?: ToolApprovalMode;
  overrides?: Record<string, ToolSourceApprovalOverride>;
}

export interface OpenApiToolSourceConfig {
  spec: string | Record<string, unknown>;
  baseUrl?: string;
  auth?: ToolSourceAuth;
  defaultReadApproval?: ToolApprovalMode;
  defaultWriteApproval?: ToolApprovalMode;
  overrides?: Record<string, ToolSourceApprovalOverride>;
}

export interface GraphqlToolSourceConfig {
  endpoint: string;
  schema?: Record<string, unknown>;
  auth?: ToolSourceAuth;
  defaultQueryApproval?: ToolApprovalMode;
  defaultMutationApproval?: ToolApprovalMode;
  overrides?: Record<string, ToolSourceApprovalOverride>;
}

interface ToolSourceRecordBase {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ToolSourceRecord =
  | (ToolSourceRecordBase & { type: "mcp"; config: McpToolSourceConfig })
  | (ToolSourceRecordBase & { type: "openapi"; config: OpenApiToolSourceConfig })
  | (ToolSourceRecordBase & { type: "graphql"; config: GraphqlToolSourceConfig });

// ── Descriptors ───────────────────────────────────────────────────────────────

export interface ToolDescriptor {
  path: string;
  description: string;
  approval: ToolApprovalMode;
  source?: string;
  argsType?: string;
  returnsType?: string;
  /** Schema type aliases needed by argsType/returnsType (shared across tools from same source) */
  schemaTypes?: Record<string, string>;
}

export interface AnonymousContext {
  sessionId: string;
  workspaceId: string;
  actorId: string;
  clientId: string;
  accountId?: string;
  createdAt: number;
  lastSeenAt: number;
}
