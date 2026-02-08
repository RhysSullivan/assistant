import type {
  AccessPolicyRecord,
  ApprovalRecord,
  AnonymousContext,
  CreateTaskRequest,
  CreateTaskResponse,
  CredentialDescriptor,
  CredentialScope,
  PendingApprovalRecord,
  PolicyDecision,
  ResolveApprovalRequest,
  RuntimeTargetDescriptor,
  TaskEventRecord,
  TaskRecord,
  ToolSourceRecord,
  ToolDescriptor,
} from "@executor/contracts";

function withBase(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed: ${response.status} ${response.statusText} - ${text}`);
  }
  return (await response.json()) as T;
}

export async function createTask(
  baseUrl: string,
  request: CreateTaskRequest,
): Promise<CreateTaskResponse> {
  const response = await fetch(withBase(baseUrl, "/api/tasks"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseJson<CreateTaskResponse>(response);
}

export async function listTasks(baseUrl: string): Promise<TaskRecord[]> {
  throw new Error("listTasks now requires workspaceId. Use listTasksForWorkspace.");
}

export async function listTasksForWorkspace(baseUrl: string, workspaceId: string): Promise<TaskRecord[]> {
  const response = await fetch(
    withBase(baseUrl, `/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`),
  );
  return parseJson<TaskRecord[]>(response);
}

export async function getTask(baseUrl: string, taskId: string, workspaceId: string): Promise<TaskRecord> {
  const response = await fetch(
    withBase(
      baseUrl,
      `/api/tasks/${encodeURIComponent(taskId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
  );
  return parseJson<TaskRecord>(response);
}

export async function listApprovals(
  baseUrl: string,
  workspaceId: string,
  status?: ApprovalRecord["status"],
): Promise<ApprovalRecord[]> {
  const search = status
    ? `?workspaceId=${encodeURIComponent(workspaceId)}&status=${encodeURIComponent(status)}`
    : `?workspaceId=${encodeURIComponent(workspaceId)}`;
  const response = await fetch(withBase(baseUrl, `/api/approvals${search}`));
  return parseJson<ApprovalRecord[]>(response);
}

export async function listPendingApprovals(
  baseUrl: string,
  workspaceId: string,
): Promise<PendingApprovalRecord[]> {
  const response = await fetch(
    withBase(baseUrl, `/api/approvals?workspaceId=${encodeURIComponent(workspaceId)}&status=pending`),
  );
  return parseJson<PendingApprovalRecord[]>(response);
}

export async function resolveApproval(
  baseUrl: string,
  approvalId: string,
  request: ResolveApprovalRequest,
): Promise<{ approval: ApprovalRecord; task: TaskRecord }> {
  const response = await fetch(withBase(baseUrl, `/api/approvals/${encodeURIComponent(approvalId)}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseJson<{ approval: ApprovalRecord; task: TaskRecord }>(response);
}

export async function listRuntimeTargets(baseUrl: string): Promise<RuntimeTargetDescriptor[]> {
  const response = await fetch(withBase(baseUrl, "/api/runtime-targets"));
  return parseJson<RuntimeTargetDescriptor[]>(response);
}

export async function listTools(baseUrl: string): Promise<ToolDescriptor[]> {
  throw new Error("listTools now requires workspace context. Use listToolsForContext.");
}

export async function listToolsForContext(
  baseUrl: string,
  context: { workspaceId: string; actorId?: string; clientId?: string },
): Promise<ToolDescriptor[]> {
  const params = new URLSearchParams({ workspaceId: context.workspaceId });
  if (context.actorId) params.set("actorId", context.actorId);
  if (context.clientId) params.set("clientId", context.clientId);
  const response = await fetch(withBase(baseUrl, `/api/tools?${params.toString()}`));
  return parseJson<ToolDescriptor[]>(response);
}

export async function listToolSources(
  baseUrl: string,
  workspaceId: string,
): Promise<ToolSourceRecord[]> {
  const response = await fetch(
    withBase(baseUrl, `/api/tool-sources?workspaceId=${encodeURIComponent(workspaceId)}`),
  );
  return parseJson<ToolSourceRecord[]>(response);
}

export async function upsertToolSource(
  baseUrl: string,
  request: {
    id?: string;
    workspaceId: string;
    name: string;
    type: "mcp" | "openapi" | "graphql";
    config: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<ToolSourceRecord> {
  const response = await fetch(withBase(baseUrl, "/api/tool-sources"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseJson<ToolSourceRecord>(response);
}

export async function deleteToolSource(
  baseUrl: string,
  workspaceId: string,
  sourceId: string,
): Promise<{ ok: boolean }> {
  const response = await fetch(
    withBase(
      baseUrl,
      `/api/tool-sources/${encodeURIComponent(sourceId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
    { method: "DELETE" },
  );
  return parseJson<{ ok: boolean }>(response);
}

export async function bootstrapAnonymousContext(
  baseUrl: string,
  sessionId?: string,
): Promise<AnonymousContext> {
  const response = await fetch(withBase(baseUrl, "/api/auth/anonymous/bootstrap"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return parseJson<AnonymousContext>(response);
}

export async function listPolicies(
  baseUrl: string,
  workspaceId: string,
): Promise<AccessPolicyRecord[]> {
  const response = await fetch(
    withBase(baseUrl, `/api/policies?workspaceId=${encodeURIComponent(workspaceId)}`),
  );
  return parseJson<AccessPolicyRecord[]>(response);
}

export async function upsertPolicy(
  baseUrl: string,
  request: {
    id?: string;
    workspaceId: string;
    actorId?: string;
    clientId?: string;
    toolPathPattern: string;
    decision: PolicyDecision;
    priority?: number;
  },
): Promise<AccessPolicyRecord> {
  const response = await fetch(withBase(baseUrl, "/api/policies"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseJson<AccessPolicyRecord>(response);
}

export async function listCredentials(
  baseUrl: string,
  workspaceId: string,
): Promise<CredentialDescriptor[]> {
  const response = await fetch(
    withBase(baseUrl, `/api/credentials?workspaceId=${encodeURIComponent(workspaceId)}`),
  );
  return parseJson<CredentialDescriptor[]>(response);
}

export async function upsertCredential(
  baseUrl: string,
  request: {
    id?: string;
    workspaceId: string;
    sourceKey: string;
    scope: CredentialScope;
    actorId?: string;
    secretJson: Record<string, unknown>;
  },
): Promise<CredentialDescriptor> {
  const response = await fetch(withBase(baseUrl, "/api/credentials"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseJson<CredentialDescriptor>(response);
}

export function subscribeToTaskEvents(
  baseUrl: string,
  taskId: string,
  workspaceId: string,
  onEvent: (eventName: TaskEventRecord["eventName"], event: TaskEventRecord) => void,
): EventSource {
  const source = new EventSource(
    withBase(
      baseUrl,
      `/api/tasks/${encodeURIComponent(taskId)}/events?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
  );

  source.addEventListener("task", (event) => {
    const message = event as MessageEvent<string>;
    onEvent("task", JSON.parse(message.data) as TaskEventRecord);
  });

  source.addEventListener("approval", (event) => {
    const message = event as MessageEvent<string>;
    onEvent("approval", JSON.parse(message.data) as TaskEventRecord);
  });

  return source;
}
