import type {
  ApprovalRecord,
  CreateTaskRequest,
  CreateTaskResponse,
  PendingApprovalRecord,
  ResolveApprovalRequest,
  RuntimeTargetDescriptor,
  TaskEventRecord,
  TaskRecord,
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
  const response = await fetch(withBase(baseUrl, "/api/tasks"));
  return parseJson<TaskRecord[]>(response);
}

export async function getTask(baseUrl: string, taskId: string): Promise<TaskRecord> {
  const response = await fetch(withBase(baseUrl, `/api/tasks/${encodeURIComponent(taskId)}`));
  return parseJson<TaskRecord>(response);
}

export async function listApprovals(
  baseUrl: string,
  status?: ApprovalRecord["status"],
): Promise<ApprovalRecord[]> {
  const search = status ? `?status=${encodeURIComponent(status)}` : "";
  const response = await fetch(withBase(baseUrl, `/api/approvals${search}`));
  return parseJson<ApprovalRecord[]>(response);
}

export async function listPendingApprovals(baseUrl: string): Promise<PendingApprovalRecord[]> {
  const response = await fetch(withBase(baseUrl, "/api/approvals?status=pending"));
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
  const response = await fetch(withBase(baseUrl, "/api/tools"));
  return parseJson<ToolDescriptor[]>(response);
}

export function subscribeToTaskEvents(
  baseUrl: string,
  taskId: string,
  onEvent: (eventName: TaskEventRecord["eventName"], event: TaskEventRecord) => void,
): EventSource {
  const source = new EventSource(
    withBase(baseUrl, `/api/tasks/${encodeURIComponent(taskId)}/events`),
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
