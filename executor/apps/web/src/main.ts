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

const state = {
  tasks: [] as TaskRecord[],
  approvals: [] as PendingApproval[],
  runtimes: [] as RuntimeTarget[],
  selectedTaskId: null as string | null,
};

const els = {
  form: document.querySelector<HTMLFormElement>("#new-task-form")!,
  runtimeSelect: document.querySelector<HTMLSelectElement>("#runtime-id")!,
  timeoutInput: document.querySelector<HTMLInputElement>("#timeout-ms")!,
  code: document.querySelector<HTMLTextAreaElement>("#task-code")!,
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

  selectedTaskStream = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/events`);
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
  renderMetrics();
  renderRuntimeOptions();
  renderApprovals();
  renderTasks();
  renderTaskDetail();
}

async function refreshData(options?: { keepSelection?: boolean }): Promise<void> {
  const [approvals, tasks, runtimes] = await Promise.all([
    requestJson<PendingApproval[]>("/api/approvals?status=pending"),
    requestJson<TaskRecord[]>("/api/tasks"),
    requestJson<RuntimeTarget[]>("/api/runtime-targets"),
  ]);

  state.approvals = approvals;
  state.tasks = tasks;
  state.runtimes = runtimes;

  const selectedStillExists = state.tasks.some((task) => task.id === state.selectedTaskId);
  if (!selectedStillExists || !options?.keepSelection) {
    state.selectedTaskId = state.tasks[0]?.id ?? null;
    connectToSelectedTask(state.selectedTaskId);
  }

  renderAll();
}

async function createTask(): Promise<void> {
  await requestJson("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: els.code.value,
      timeoutMs: Number(els.timeoutInput.value),
      runtimeId: els.runtimeSelect.value,
    }),
  });

  await refreshData();
}

async function resolveApproval(approvalId: string, decision: "approved" | "denied"): Promise<void> {
  await requestJson(`/api/approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, reviewerId: "web-ui" }),
  });
  await refreshData({ keepSelection: true });
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void createTask().catch((cause) => {
    console.error(cause);
    window.alert(`Failed to create task: ${String(cause)}`);
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

void refreshData().catch((cause) => {
  console.error(cause);
  window.alert(`Failed to load executor dashboard: ${String(cause)}`);
});

setInterval(() => {
  void refreshData({ keepSelection: true });
}, 5_000);
