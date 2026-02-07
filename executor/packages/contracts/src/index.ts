export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "denied";

export type ApprovalStatus = "pending" | "approved" | "denied";
export type ApprovalDecision = "approved" | "denied";

export interface CreateTaskRequest {
  code: string;
  runtimeId?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
}

export interface TaskRecord {
  id: string;
  code: string;
  runtimeId: string;
  timeoutMs: number;
  metadata: Record<string, unknown>;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  toolPath: string;
  input: unknown;
  status: ApprovalStatus;
  createdAt: number;
  resolvedAt?: number;
  reviewerId?: string;
  reason?: string;
}

export interface PendingApprovalRecord extends ApprovalRecord {
  task: Pick<TaskRecord, "id" | "status" | "runtimeId" | "timeoutMs" | "createdAt">;
}

export interface ResolveApprovalRequest {
  decision: ApprovalDecision;
  reviewerId?: string;
  reason?: string;
}

export interface RuntimeTargetDescriptor {
  id: string;
  label: string;
  description: string;
}

export interface ToolDescriptor {
  path: string;
  description: string;
  approval: "auto" | "required";
}

export interface TaskEventRecord {
  id: number;
  taskId: string;
  eventName: "task" | "approval";
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface SandboxExecutionRequest {
  taskId: string;
  code: string;
  timeoutMs: number;
}

export interface SandboxExecutionResult {
  status: "completed" | "failed" | "timed_out" | "denied";
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
  durationMs: number;
}
