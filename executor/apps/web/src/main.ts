type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "denied";

interface TaskRecord {
  id: string;
  runtimeId: string;
  timeoutMs: number;
  status: TaskStatus;
  code: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  exitCode?: number;
}

interface PendingApproval {
  id: string;
  taskId: string;
  toolPath: string;
  input: unknown;
  createdAt: number;
  task: {
    id: string;
    status: TaskStatus;
    runtimeId: string;
    timeoutMs: number;
    createdAt: number;
  };
}

interface RuntimeTarget {
  id: string;
  label: string;
  description: string;
}

interface ToolDescriptor {
  path: string;
  description: string;
  approval: "auto" | "required";
  source?: string;
  argsType?: string;
  returnsType?: string;
}

interface ToolSourceRecord {
  id: string;
  workspaceId: string;
  name: string;
  type: "mcp" | "openapi";
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AnonymousContext {
  sessionId: string;
  workspaceId: string;
  actorId: string;
  clientId: string;
}

const state = {
  tasks: [] as TaskRecord[],
  approvals: [] as PendingApproval[],
  runtimes: [] as RuntimeTarget[],
  toolSources: [] as ToolSourceRecord[],
  tools: [] as ToolDescriptor[],
  selectedTaskId: null as string | null,
  context: null as AnonymousContext | null,
};

const els = {
  form: document.querySelector<HTMLFormElement>("#new-task-form")!,
  runtimeSelect: document.querySelector<HTMLSelectElement>("#runtime-id")!,
  timeoutInput: document.querySelector<HTMLInputElement>("#timeout-ms")!,
  code: document.querySelector<HTMLTextAreaElement>("#task-code")!,
  contextWorkspace: document.querySelector<HTMLElement>("#context-workspace"),
  contextActor: document.querySelector<HTMLElement>("#context-actor"),
  contextSession: document.querySelector<HTMLElement>("#context-session"),
  resetSessionButton: document.querySelector<HTMLButtonElement>("#reset-session-button"),
  sourceForm: document.querySelector<HTMLFormElement>("#source-form"),
  sourceType: document.querySelector<HTMLSelectElement>("#source-type"),
  sourceName: document.querySelector<HTMLInputElement>("#source-name"),
  sourceUrl: document.querySelector<HTMLInputElement>("#source-url"),
  openapiBaseUrlWrap: document.querySelector<HTMLElement>("#openapi-base-url-wrap"),
  openapiBaseUrl: document.querySelector<HTMLInputElement>("#openapi-base-url"),
  openapiAuthGrid: document.querySelector<HTMLElement>("#openapi-auth-grid"),
  openapiAuthMode: document.querySelector<HTMLSelectElement>("#openapi-auth-mode"),
  openapiApiKeyHeader: document.querySelector<HTMLInputElement>("#openapi-api-key-header"),
  openapiStaticTokenWrap: document.querySelector<HTMLElement>("#openapi-static-token-wrap"),
  openapiStaticToken: document.querySelector<HTMLInputElement>("#openapi-static-token"),
  toolSourcesList: document.querySelector<HTMLDivElement>("#tool-sources-list"),
  toolInventoryList: document.querySelector<HTMLDivElement>("#tool-inventory-list"),
  toolCount: document.querySelector<HTMLElement>("#tool-count"),
  metricPending: document.querySelector<HTMLElement>("#metric-pending"),
  metricTotalTasks: document.querySelector<HTMLElement>("#metric-total-tasks"),
  metricRunning: document.querySelector<HTMLElement>("#metric-running"),
  approvalsList: document.querySelector<HTMLDivElement>("#approvals-list")!,
  approvalCount: document.querySelector<HTMLSpanElement>("#approval-count")!,
  tasksList: document.querySelector<HTMLDivElement>("#tasks-list")!,
  taskDetail: document.querySelector<HTMLDivElement>("#task-detail")!,
  refreshButton: document.querySelector<HTMLButtonElement>("#refresh-button")!,
};

let selectedTaskStream: EventSource | null = null;
const ANON_SESSION_STORAGE_KEY = "executor.anonymous.session_id";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fmtTime(timestamp?: number): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString();
}

function statusClass(status: TaskStatus): string {
  return `status status-${status.replaceAll("_", "-")}`;
}

function labelStatus(status: TaskStatus): string {
  return status.replaceAll("_", " ");
}

function shortId(value: string): string {
  return value.length <= 22 ? value : `${value.slice(0, 18)}...`;
}

function renderContext(): void {
  const context = state.context;
  if (!context) return;

  if (els.contextWorkspace) {
    els.contextWorkspace.textContent = shortId(context.workspaceId);
    els.contextWorkspace.title = context.workspaceId;
  }

  if (els.contextActor) {
    els.contextActor.textContent = shortId(context.actorId);
    els.contextActor.title = context.actorId;
  }

  if (els.contextSession) {
    els.contextSession.textContent = shortId(context.sessionId);
    els.contextSession.title = context.sessionId;
  }
}

function renderSourceFormVisibility(): void {
  const type = els.sourceType?.value ?? "mcp";
  const isOpenApi = type === "openapi";

  if (els.openapiBaseUrlWrap) {
    els.openapiBaseUrlWrap.style.display = isOpenApi ? "grid" : "none";
  }
  if (els.openapiAuthGrid) {
    els.openapiAuthGrid.style.display = isOpenApi ? "grid" : "none";
  }
  if (els.openapiStaticTokenWrap) {
    const mode = els.openapiAuthMode?.value ?? "none";
    els.openapiStaticTokenWrap.style.display = isOpenApi && mode.startsWith("static-") ? "grid" : "none";
  }
}

function renderToolSources(): void {
  if (!els.toolSourcesList) return;

  if (state.toolSources.length === 0) {
    els.toolSourcesList.innerHTML = '<p class="empty">No workspace tool sources yet.</p>';
    return;
  }

  els.toolSourcesList.innerHTML = state.toolSources
    .map((source) => {
      const configText = prettyJson(source.config);
      return `
        <article class="source-card">
          <header>
            <strong>${escapeHtml(source.name)}</strong>
            <span class="tag">${escapeHtml(source.type)}</span>
          </header>
          <p class="source-meta">${escapeHtml(source.id)} • updated ${fmtTime(source.updatedAt)}</p>
          <pre>${escapeHtml(configText)}</pre>
          <div class="source-actions">
            <button class="danger" data-source-delete="${source.id}">Remove</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderToolInventory(): void {
  if (els.toolCount) {
    els.toolCount.textContent = String(state.tools.length);
  }

  if (!els.toolInventoryList) return;
  if (state.tools.length === 0) {
    els.toolInventoryList.innerHTML = '<p class="empty">No tools discovered for this workspace yet.</p>';
    return;
  }

  els.toolInventoryList.innerHTML = state.tools
    .map((tool) => `
      <article class="inventory-card">
        <header>
          <strong>${escapeHtml(tool.path)}</strong>
          <span class="tag">${escapeHtml(tool.approval)}</span>
        </header>
        <p class="inventory-meta">source: ${escapeHtml(tool.source ?? "local")}</p>
        <p class="inventory-meta">${escapeHtml(tool.description)}</p>
      </article>
    `)
    .join("");
}

function renderMetrics(): void {
  const runningCount = state.tasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  ).length;

  if (els.metricPending) {
    els.metricPending.textContent = String(state.approvals.length);
  }

  if (els.metricTotalTasks) {
    els.metricTotalTasks.textContent = String(state.tasks.length);
  }

  if (els.metricRunning) {
    els.metricRunning.textContent = String(runningCount);
  }
}

function connectToSelectedTask(taskId: string | null): void {
  if (selectedTaskStream) {
    selectedTaskStream.close();
    selectedTaskStream = null;
  }
  if (!taskId) return;
  if (!state.context) return;

  selectedTaskStream = new EventSource(
    `/api/tasks/${encodeURIComponent(taskId)}/events?workspaceId=${encodeURIComponent(state.context.workspaceId)}`,
  );
  const onEvent = () => {
    void refreshData({ keepSelection: true });
  };
  selectedTaskStream.addEventListener("task", onEvent);
  selectedTaskStream.addEventListener("approval", onEvent);
}

function renderRuntimeOptions(): void {
  els.runtimeSelect.innerHTML = state.runtimes
    .map((runtime) => `<option value="${runtime.id}">${escapeHtml(runtime.label)}</option>`)
    .join("");
}

function renderApprovals(): void {
  els.approvalCount.textContent = String(state.approvals.length);
  if (state.approvals.length === 0) {
    els.approvalsList.innerHTML = '<p class="empty">No pending tool approvals.</p>';
    return;
  }

  els.approvalsList.innerHTML = state.approvals
    .map((approval) => {
      const inputJson = prettyJson(approval.input);
      return `
        <article class="approval-card">
          <header>
            <strong>${escapeHtml(approval.toolPath)}</strong>
            <span>${escapeHtml(approval.taskId)}</span>
          </header>
          <p class="meta">Requested ${fmtTime(approval.createdAt)} • status ${escapeHtml(approval.task.status)}</p>
          <pre>${escapeHtml(inputJson)}</pre>
          <div class="actions">
            <button data-action="approve" data-approval-id="${approval.id}">Approve call</button>
            <button class="danger" data-action="deny" data-approval-id="${approval.id}">Deny call</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTasks(): void {
  if (state.tasks.length === 0) {
    els.tasksList.innerHTML = '<p class="empty">No tasks yet.</p>';
    return;
  }

  els.tasksList.innerHTML = state.tasks
    .map((task) => {
      const selected = task.id === state.selectedTaskId ? "selected" : "";
      return `
        <button class="task-row ${selected}" data-task-id="${task.id}">
          <span>${escapeHtml(task.id)}</span>
          <span>${escapeHtml(task.runtimeId)}</span>
          <span class="${statusClass(task.status)}">${labelStatus(task.status)}</span>
          <span>${fmtTime(task.createdAt)}</span>
        </button>
      `;
    })
    .join("");
}

function renderTaskDetail(): void {
  const task = state.tasks.find((entry) => entry.id === state.selectedTaskId);
  if (!task) {
    els.taskDetail.classList.add("empty");
    els.taskDetail.textContent = "Select a task to inspect logs.";
    return;
  }

  els.taskDetail.classList.remove("empty");
  els.taskDetail.innerHTML = `
    <div class="detail-grid">
      <div><span>Task</span><strong>${escapeHtml(task.id)}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(labelStatus(task.status))}</strong></div>
      <div><span>Runtime</span><strong>${escapeHtml(task.runtimeId)}</strong></div>
      <div><span>Exit code</span><strong>${task.exitCode ?? "-"}</strong></div>
    </div>
    <h3>Code</h3>
    <pre>${escapeHtml(task.code)}</pre>
    <h3>Stdout</h3>
    <pre>${escapeHtml(task.stdout ?? "")}</pre>
    <h3>Stderr</h3>
    <pre>${escapeHtml(task.stderr ?? "")}</pre>
    ${task.error ? `<h3>Error</h3><pre>${escapeHtml(task.error)}</pre>` : ""}
  `;
}

function renderAll(): void {
  renderContext();
  renderSourceFormVisibility();
  renderMetrics();
  renderRuntimeOptions();
  renderToolSources();
  renderToolInventory();
  renderApprovals();
  renderTasks();
  renderTaskDetail();
}

async function refreshData(options?: { keepSelection?: boolean }): Promise<void> {
  if (!state.context) {
    throw new Error("Anonymous context missing");
  }

  const [approvals, tasks, runtimes, toolSources, tools] = await Promise.all([
    requestJson<PendingApproval[]>(
      `/api/approvals?workspaceId=${encodeURIComponent(state.context.workspaceId)}&status=pending`,
    ),
    requestJson<TaskRecord[]>(`/api/tasks?workspaceId=${encodeURIComponent(state.context.workspaceId)}`),
    requestJson<RuntimeTarget[]>("/api/runtime-targets"),
    requestJson<ToolSourceRecord[]>(`/api/tool-sources?workspaceId=${encodeURIComponent(state.context.workspaceId)}`),
    requestJson<ToolDescriptor[]>(
      `/api/tools?workspaceId=${encodeURIComponent(state.context.workspaceId)}&actorId=${encodeURIComponent(state.context.actorId)}&clientId=${encodeURIComponent(state.context.clientId)}`,
    ),
  ]);

  state.approvals = approvals;
  state.tasks = tasks;
  state.runtimes = runtimes;
  state.toolSources = toolSources;
  state.tools = tools;

  const selectedStillExists = state.tasks.some((task) => task.id === state.selectedTaskId);
  if (!selectedStillExists || !options?.keepSelection) {
    state.selectedTaskId = state.tasks[0]?.id ?? null;
    connectToSelectedTask(state.selectedTaskId);
  }

  renderAll();
}

async function createTask(): Promise<void> {
  if (!state.context) {
    throw new Error("Anonymous context missing");
  }

  await requestJson("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: els.code.value,
      timeoutMs: Number(els.timeoutInput.value),
      runtimeId: els.runtimeSelect.value,
      workspaceId: state.context.workspaceId,
      actorId: state.context.actorId,
      clientId: state.context.clientId,
    }),
  });

  await refreshData();
}

async function resolveApproval(approvalId: string, decision: "approved" | "denied"): Promise<void> {
  if (!state.context) {
    throw new Error("Anonymous context missing");
  }

  await requestJson(`/api/approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: state.context.workspaceId,
      decision,
      reviewerId: state.context.actorId,
    }),
  });
  await refreshData({ keepSelection: true });
}

async function bootstrapAnonymousContext(): Promise<void> {
  const sessionId = window.localStorage.getItem(ANON_SESSION_STORAGE_KEY) ?? undefined;
  const context = await requestJson<AnonymousContext>("/api/auth/anonymous/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  state.context = context;
  window.localStorage.setItem(ANON_SESSION_STORAGE_KEY, context.sessionId);
}

async function resetAnonymousContext(): Promise<void> {
  window.localStorage.removeItem(ANON_SESSION_STORAGE_KEY);
  await bootstrapAnonymousContext();
  state.selectedTaskId = null;
  connectToSelectedTask(null);
  await refreshData();
}

function buildOpenApiAuthConfig(): Record<string, unknown> {
  const mode = els.openapiAuthMode?.value ?? "none";
  if (mode === "none") {
    return { type: "none" };
  }

  const token = (els.openapiStaticToken?.value ?? "").trim();
  const headerName = (els.openapiApiKeyHeader?.value ?? "").trim() || "x-api-key";

  if (mode === "static-bearer") {
    return { type: "bearer", mode: "static", token };
  }
  if (mode === "static-api-key") {
    return { type: "apiKey", mode: "static", header: headerName, value: token };
  }
  if (mode === "workspace-bearer") {
    return { type: "bearer", mode: "workspace" };
  }
  if (mode === "actor-bearer") {
    return { type: "bearer", mode: "actor" };
  }
  if (mode === "workspace-api-key") {
    return { type: "apiKey", mode: "workspace", header: headerName };
  }
  if (mode === "actor-api-key") {
    return { type: "apiKey", mode: "actor", header: headerName };
  }

  return { type: "none" };
}

async function createToolSourceFromForm(): Promise<void> {
  if (!state.context) {
    throw new Error("Anonymous context missing");
  }

  const type = (els.sourceType?.value ?? "mcp") as "mcp" | "openapi";
  const name = (els.sourceName?.value ?? "").trim();
  const url = (els.sourceUrl?.value ?? "").trim();
  const baseUrl = (els.openapiBaseUrl?.value ?? "").trim();

  if (!name) {
    throw new Error("Source name is required");
  }
  if (!url) {
    throw new Error("Endpoint/spec URL is required");
  }

  const config: Record<string, unknown> =
    type === "mcp"
      ? { url }
      : {
          spec: url,
          ...(baseUrl ? { baseUrl } : {}),
          auth: buildOpenApiAuthConfig(),
        };

  await requestJson("/api/tool-sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: state.context.workspaceId,
      name,
      type,
      config,
      enabled: true,
    }),
  });

  if (els.sourceForm) {
    els.sourceForm.reset();
    if (els.sourceType) els.sourceType.value = "mcp";
    if (els.openapiAuthMode) els.openapiAuthMode.value = "none";
    renderSourceFormVisibility();
  }

  await refreshData({ keepSelection: true });
}

async function deleteToolSource(sourceId: string): Promise<void> {
  if (!state.context) {
    throw new Error("Anonymous context missing");
  }

  await requestJson(
    `/api/tool-sources/${encodeURIComponent(sourceId)}?workspaceId=${encodeURIComponent(state.context.workspaceId)}`,
    { method: "DELETE" },
  );

  await refreshData({ keepSelection: true });
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void createTask().catch((cause) => {
    console.error(cause);
    window.alert(`Failed to create task: ${String(cause)}`);
  });
});

els.sourceForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createToolSourceFromForm().catch((cause) => {
    console.error(cause);
    window.alert(`Failed to create tool source: ${String(cause)}`);
  });
});

els.sourceType?.addEventListener("change", () => {
  renderSourceFormVisibility();
});

els.openapiAuthMode?.addEventListener("change", () => {
  renderSourceFormVisibility();
});

els.toolSourcesList?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-source-delete]");
  if (!button) return;
  const sourceId = button.dataset.sourceDelete;
  if (!sourceId) return;

  void deleteToolSource(sourceId).catch((cause) => {
    console.error(cause);
    window.alert(`Failed to remove tool source: ${String(cause)}`);
  });
});

els.approvalsList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.dataset.action;
  const approvalId = target.dataset.approvalId;
  if (!action || !approvalId) return;

  const decision = action === "approve" ? "approved" : "denied";
  void resolveApproval(approvalId, decision).catch((cause) => {
    console.error(cause);
    window.alert(`Failed to resolve approval: ${String(cause)}`);
  });
});

els.tasksList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.task-row");
  if (!button) return;
  state.selectedTaskId = button.dataset.taskId ?? null;
  connectToSelectedTask(state.selectedTaskId);
  renderTasks();
  renderTaskDetail();
});

els.refreshButton.addEventListener("click", () => {
  void refreshData({ keepSelection: true });
});

els.resetSessionButton?.addEventListener("click", () => {
  void resetAnonymousContext().catch((cause) => {
    console.error(cause);
    window.alert(`Failed to reset anonymous workspace: ${String(cause)}`);
  });
});

void (async () => {
  try {
    await bootstrapAnonymousContext();
    await refreshData();
    setInterval(() => {
      void refreshData({ keepSelection: true });
    }, 5_000);
  } catch (cause) {
    console.error(cause);
    window.alert(`Failed to load executor dashboard: ${String(cause)}`);
  }
})();
