export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "denied";

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface TaskRecord {
  id: string;
  code: string;
  runtimeId: string;
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

export interface TaskEventRecord {
  id: number;
  taskId: string;
  eventName: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

export interface CreateTaskInput {
  code: string;
  timeoutMs?: number;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  workspaceId: string;
  actorId: string;
  clientId?: string;
}

export interface AnonymousContext {
  sessionId: string;
  workspaceId: string;
  actorId: string;
  clientId: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface SandboxExecutionRequest {
  taskId: string;
  code: string;
  timeoutMs: number;
}

export interface SandboxExecutionResult {
  status: Extract<TaskStatus, "completed" | "failed" | "timed_out" | "denied">;
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
  durationMs: number;
}

export interface ToolCallRequest {
  runId: string;
  callId: string;
  toolPath: string;
  input: unknown;
}

export type ToolCallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; denied?: boolean };

export type RuntimeOutputStream = "stdout" | "stderr";

export interface RuntimeOutputEvent {
  runId: string;
  stream: RuntimeOutputStream;
  line: string;
  timestamp: number;
}

export interface ExecutionAdapter {
  invokeTool(call: ToolCallRequest): Promise<ToolCallResult>;
  emitOutput(event: RuntimeOutputEvent): void | Promise<void>;
}

export interface SandboxRuntime {
  id: string;
  label: string;
  description: string;
  run(
    request: SandboxExecutionRequest,
    adapter: ExecutionAdapter,
  ): Promise<SandboxExecutionResult>;
}

export type ToolApprovalMode = "auto" | "required";

export type PolicyDecision = "allow" | "require_approval" | "deny";

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

export type CredentialScope = "workspace" | "actor";

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

export type ToolCredentialAuthType = "bearer" | "apiKey" | "basic";

export interface ToolCredentialSpec {
  sourceKey: string;
  mode: CredentialScope;
  authType: ToolCredentialAuthType;
  headerName?: string;
  staticSecretJson?: Record<string, unknown>;
}

export interface ResolvedToolCredential {
  sourceKey: string;
  mode: CredentialScope;
  headers: Record<string, string>;
}

export interface ToolRunContext {
  taskId: string;
  workspaceId: string;
  actorId?: string;
  clientId?: string;
  credential?: ResolvedToolCredential;
  isToolAllowed: (toolPath: string) => boolean;
}

export interface ToolTypeMetadata {
  argsType?: string;
  returnsType?: string;
}

export interface ToolDefinition {
  path: string;
  description: string;
  approval: ToolApprovalMode;
  source?: string;
  metadata?: ToolTypeMetadata;
  credential?: ToolCredentialSpec;
  run(input: unknown, context: ToolRunContext): Promise<unknown>;
}

export interface ToolDescriptor {
  path: string;
  description: string;
  approval: ToolApprovalMode;
  source?: string;
  argsType?: string;
  returnsType?: string;
}

export interface ToolSourceRecord {
  id: string;
  workspaceId: string;
  name: string;
  type: "mcp" | "openapi";
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
