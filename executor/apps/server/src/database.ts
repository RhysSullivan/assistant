import { Database } from "bun:sqlite";
import type {
  ApprovalRecord,
  ApprovalStatus,
  PendingApprovalRecord,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseMetadata(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mapTaskRow(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    runtimeId: String(row.runtime_id),
    status: String(row.status) as TaskStatus,
    timeoutMs: typeof row.timeout_ms === "number" ? row.timeout_ms : DEFAULT_TIMEOUT_MS,
    metadata: parseMetadata(row.metadata),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    startedAt: optionalNumber(row.started_at),
    completedAt: optionalNumber(row.completed_at),
    error: optionalString(row.error),
    stdout: optionalString(row.stdout),
    stderr: optionalString(row.stderr),
    exitCode: optionalNumber(row.exit_code),
  };
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    toolPath: String(row.tool_path),
    input: parseJson(row.input_json),
    status: String(row.status) as ApprovalStatus,
    reason: optionalString(row.reason),
    reviewerId: optionalString(row.reviewer_id),
    createdAt: Number(row.created_at),
    resolvedAt: optionalNumber(row.resolved_at),
  };
}

function mapEventRow(row: Record<string, unknown>): TaskEventRecord {
  const payload = parseJson(row.payload_json);
  return {
    id: Number(row.id),
    taskId: String(row.task_id),
    eventName: String(row.event_name),
    type: String(row.event_type),
    payload: payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
    createdAt: Number(row.created_at),
  };
}

export class ExecutorDatabase {
  private readonly db: Database;

  constructor(dbPath = Bun.env.EXECUTOR_DB_PATH ?? "./executor-v2.sqlite") {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        status TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL,
        metadata TEXT NOT NULL,
        error TEXT,
        stdout TEXT,
        stderr TEXT,
        exit_code INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        tool_path TEXT NOT NULL,
        input_json TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        reviewer_id TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id, id ASC);
    `);
  }

  createTask(params: {
    id: string;
    code: string;
    runtimeId: string;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
  }): TaskRecord {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO tasks (
        id,
        code,
        runtime_id,
        status,
        timeout_ms,
        metadata,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)
    `).run(
      params.id,
      params.code,
      params.runtimeId,
      params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      JSON.stringify(params.metadata ?? {}),
      now,
      now,
    );

    const task = this.getTask(params.id);
    if (!task) {
      throw new Error(`Failed to fetch created task ${params.id}`);
    }
    return task;
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | Record<string, unknown>
      | null;
    return row ? mapTaskRow(row) : null;
  }

  listTasks(): TaskRecord[] {
    const rows = this.db
      .query("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500")
      .all() as Record<string, unknown>[];
    return rows.map(mapTaskRow);
  }

  markTaskRunning(taskId: string): TaskRecord | null {
    const now = Date.now();
    this.db.prepare(`
      UPDATE tasks
      SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE id = ?
    `).run(now, now, taskId);
    return this.getTask(taskId);
  }

  markTaskFinished(params: {
    taskId: string;
    status: Extract<TaskStatus, "completed" | "failed" | "timed_out" | "denied">;
    stdout: string;
    stderr: string;
    exitCode?: number;
    error?: string;
  }): TaskRecord | null {
    const now = Date.now();
    this.db.prepare(`
      UPDATE tasks
      SET
        status = ?,
        stdout = ?,
        stderr = ?,
        exit_code = ?,
        error = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      params.status,
      params.stdout,
      params.stderr,
      params.exitCode ?? null,
      params.error ?? null,
      now,
      now,
      params.taskId,
    );
    return this.getTask(params.taskId);
  }

  createApproval(params: {
    id: string;
    taskId: string;
    toolPath: string;
    input: unknown;
  }): ApprovalRecord {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO approvals (
        id,
        task_id,
        tool_path,
        input_json,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(
      params.id,
      params.taskId,
      params.toolPath,
      JSON.stringify(params.input ?? {}),
      now,
    );

    const approval = this.getApproval(params.id);
    if (!approval) {
      throw new Error(`Failed to fetch approval ${params.id}`);
    }
    return approval;
  }

  getApproval(approvalId: string): ApprovalRecord | null {
    const row = this.db.query("SELECT * FROM approvals WHERE id = ?").get(approvalId) as
      | Record<string, unknown>
      | null;
    return row ? mapApprovalRow(row) : null;
  }

  listApprovals(status?: ApprovalStatus): ApprovalRecord[] {
    const rows = status
      ? this.db.query("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC").all(status) as Record<string, unknown>[]
      : this.db.query("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 500").all() as Record<string, unknown>[];
    return rows.map(mapApprovalRow);
  }

  listPendingApprovals(): PendingApprovalRecord[] {
    const rows = this.db.prepare(`
      SELECT
        a.*,
        t.status AS task_status,
        t.runtime_id,
        t.timeout_ms,
        t.created_at AS task_created_at
      FROM approvals a
      JOIN tasks t ON t.id = a.task_id
      WHERE a.status = 'pending'
      ORDER BY a.created_at ASC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      ...mapApprovalRow(row),
      task: {
        id: String(row.task_id),
        status: String(row.task_status) as TaskStatus,
        runtimeId: String(row.runtime_id),
        timeoutMs: Number(row.timeout_ms),
        createdAt: Number(row.task_created_at),
      },
    }));
  }

  resolveApproval(params: {
    approvalId: string;
    decision: Exclude<ApprovalStatus, "pending">;
    reviewerId?: string;
    reason?: string;
  }): ApprovalRecord | null {
    const pending = this.db.query(
      "SELECT * FROM approvals WHERE id = ? AND status = 'pending'",
    ).get(params.approvalId) as Record<string, unknown> | null;

    if (!pending) {
      return null;
    }

    const now = Date.now();
    this.db.prepare(`
      UPDATE approvals
      SET status = ?, reason = ?, reviewer_id = ?, resolved_at = ?
      WHERE id = ?
    `).run(
      params.decision,
      params.reason ?? null,
      params.reviewerId ?? null,
      now,
      params.approvalId,
    );

    return this.getApproval(params.approvalId);
  }

  createTaskEvent(input: {
    taskId: string;
    eventName: TaskEventRecord["eventName"];
    type: string;
    payload: Record<string, unknown>;
  }): TaskEventRecord {
    const createdAt = Date.now();
    this.db.prepare(`
      INSERT INTO task_events (task_id, event_name, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.taskId,
      input.eventName,
      input.type,
      JSON.stringify(input.payload),
      createdAt,
    );

    const row = this.db.query("SELECT * FROM task_events WHERE id = last_insert_rowid()").get() as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new Error("Failed to read inserted task event");
    }

    return mapEventRow(row);
  }

  listTaskEvents(taskId: string): TaskEventRecord[] {
    const rows = this.db
      .query("SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(mapEventRow);
  }
}
