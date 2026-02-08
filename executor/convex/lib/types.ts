import type {
  AccessPolicyRecord as SharedAccessPolicyRecord,
  AnonymousContext as SharedAnonymousContext,
  ApprovalRecord as SharedApprovalRecord,
  ApprovalStatus,
  CredentialRecord as SharedCredentialRecord,
  CredentialScope,
  PendingApprovalRecord as SharedPendingApprovalRecord,
  PolicyDecision,
  RuntimeId,
  GraphqlToolSourceConfig,
  McpToolSourceConfig,
  OpenApiToolSourceConfig,
  TaskEventName,
  TaskEventNameForType,
  TaskEventPayloadByType,
  TaskEventType,
  TaskEventRecord as SharedTaskEventRecord,
  TaskRecord as SharedTaskRecord,
  TaskStatus,
  ToolApprovalMode,
  ToolDescriptor,
  ToolSourceRecord as SharedToolSourceRecord,
  ToolSourceType,
} from "@executor/contracts";
import type { Id } from "../_generated/dataModel";

export type {
  ApprovalStatus,
  CredentialScope,
  PolicyDecision,
  RuntimeId,
  GraphqlToolSourceConfig,
  McpToolSourceConfig,
  OpenApiToolSourceConfig,
  TaskEventName,
  TaskEventNameForType,
  TaskEventPayloadByType,
  TaskEventType,
  TaskStatus,
  ToolApprovalMode,
  ToolDescriptor,
  ToolSourceType,
};

export type TaskRecord = Omit<SharedTaskRecord, "workspaceId"> & {
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

export type AccessPolicyRecord = Omit<SharedAccessPolicyRecord, "id" | "workspaceId"> & {
  id: Id<"accessPolicies">;
  workspaceId: Id<"workspaces">;
};

export type CredentialRecord = Omit<SharedCredentialRecord, "id" | "workspaceId"> & {
  id: Id<"sourceCredentials">;
  workspaceId: Id<"workspaces">;
};

export type ToolSourceRecord = Omit<SharedToolSourceRecord, "id" | "workspaceId"> & {
  id: Id<"toolSources">;
  workspaceId: Id<"workspaces">;
};

export type AnonymousContext = Omit<SharedAnonymousContext, "workspaceId" | "accountId"> & {
  workspaceId: Id<"workspaces">;
  accountId?: Id<"accounts">;
};

// ── Server-only types ─────────────────────────────────────────────────────────

export interface CreateTaskInput {
  code: string;
  timeoutMs?: number;
  runtimeId?: RuntimeId;
  metadata?: Record<string, unknown>;
  workspaceId: Id<"workspaces">;
  actorId: string;
  clientId?: string;
}

export interface SandboxExecutionRequest {
  taskId: Id<"tasks">;
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
  runId: Id<"tasks">;
  callId: string;
  toolPath: string;
  input: unknown;
}

export type ToolCallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; denied?: boolean };

export type RuntimeOutputStream = "stdout" | "stderr";

export interface RuntimeOutputEvent {
  runId: Id<"tasks">;
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
  taskId: Id<"tasks">;
  workspaceId: Id<"workspaces">;
  actorId?: string;
  clientId?: string;
  credential?: ResolvedToolCredential;
  isToolAllowed: (toolPath: string) => boolean;
}

export interface ToolTypeMetadata {
  argsType?: string;
  returnsType?: string;
  /** Schema type aliases needed by argsType/returnsType (e.g. `{ "Account": "{ id: string; ... }" }`) */
  schemaTypes?: Record<string, string>;
}

export interface ToolDefinition {
  path: string;
  description: string;
  approval: ToolApprovalMode;
  source?: string;
  metadata?: ToolTypeMetadata;
  credential?: ToolCredentialSpec;
  /** For GraphQL sources: the source name used for dynamic path extraction */
  _graphqlSource?: string;
  /** For GraphQL pseudo-tools: marks tools that exist only for discovery/policy */
  _pseudoTool?: boolean;
  run(input: unknown, context: ToolRunContext): Promise<unknown>;
}
