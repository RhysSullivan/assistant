import { Database } from "bun:sqlite";
import type {
  AccessPolicyRecord,
  AnonymousContext,
  ApprovalRecord,
  ApprovalStatus,
  CredentialRecord,
  CredentialScope,
  PendingApprovalRecord,
  PolicyDecision,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  ToolSourceRecord,
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
    workspaceId: String(row.workspace_id),
    actorId: optionalString(row.actor_id),
    clientId: optionalString(row.client_id),
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

function mapPolicyRow(row: Record<string, unknown>): AccessPolicyRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    actorId: optionalString(row.actor_id),
    clientId: optionalString(row.client_id),
    toolPathPattern: String(row.tool_path_pattern),
    decision: String(row.decision) as PolicyDecision,
    priority: Number(row.priority),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapCredentialRow(row: Record<string, unknown>): CredentialRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sourceKey: String(row.source_key),
    scope: String(row.scope) as CredentialScope,
    actorId: optionalString(row.actor_id),
    secretJson: parseMetadata(row.secret_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapAnonymousContextRow(row: Record<string, unknown>): AnonymousContext {
  return {
    sessionId: String(row.session_id),
    workspaceId: String(row.workspace_id),
    actorId: String(row.actor_id),
    clientId: String(row.client_id),
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at),
  };
}

function mapToolSourceRow(row: Record<string, unknown>): ToolSourceRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    type: String(row.type) as "mcp" | "openapi",
    config: parseMetadata(row.config_json),
    enabled: Number(row.enabled) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
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
        workspace_id TEXT NOT NULL DEFAULT 'ws_default',
        actor_id TEXT,
        client_id TEXT,
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

      CREATE TABLE IF NOT EXISTS access_policies (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_id TEXT,
        client_id TEXT,
        tool_path_pattern TEXT NOT NULL,
        decision TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_access_policies_workspace ON access_policies(workspace_id);

      CREATE TABLE IF NOT EXISTS source_credentials (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        scope TEXT NOT NULL,
        actor_id TEXT,
        secret_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_source_credentials_unique
      ON source_credentials(workspace_id, source_key, scope, COALESCE(actor_id, ''));

      CREATE INDEX IF NOT EXISTS idx_source_credentials_workspace
      ON source_credentials(workspace_id, source_key, scope);

      CREATE TABLE IF NOT EXISTS tool_sources (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_sources_workspace
      ON tool_sources(workspace_id, enabled, updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_sources_workspace_name
      ON tool_sources(workspace_id, name);

      CREATE TABLE IF NOT EXISTS anonymous_sessions (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_workspace
      ON anonymous_sessions(workspace_id, actor_id);
    `);

    this.addColumnIfMissing("tasks", "workspace_id", "TEXT NOT NULL DEFAULT 'ws_default'");
    this.addColumnIfMissing("tasks", "actor_id", "TEXT");
    this.addColumnIfMissing("tasks", "client_id", "TEXT");

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_workspace_created ON tasks(workspace_id, created_at DESC);");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    const exists = columns.some((entry) => String(entry.name) === column);
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  }

  createTask(params: {
    id: string;
    code: string;
    runtimeId: string;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
    workspaceId: string;
    actorId: string;
    clientId?: string;
  }): TaskRecord {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO tasks (
        id,
        code,
        runtime_id,
        workspace_id,
        actor_id,
        client_id,
        status,
        timeout_ms,
        metadata,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
    `).run(
      params.id,
      params.code,
      params.runtimeId,
      params.workspaceId,
      params.actorId,
      params.clientId ?? null,
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

  listTasks(workspaceId: string): TaskRecord[] {
    const rows = this.db
      .query("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 500")
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapTaskRow);
  }

  getTaskInWorkspace(taskId: string, workspaceId: string): TaskRecord | null {
    const row = this.db.query(
      "SELECT * FROM tasks WHERE id = ? AND workspace_id = ?",
    ).get(taskId, workspaceId) as Record<string, unknown> | null;
    return row ? mapTaskRow(row) : null;
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

  listApprovals(workspaceId: string, status?: ApprovalStatus): ApprovalRecord[] {
    const rows = status
      ? this.db.query(`
          SELECT a.*
          FROM approvals a
          JOIN tasks t ON t.id = a.task_id
          WHERE t.workspace_id = ? AND a.status = ?
          ORDER BY a.created_at DESC
        `).all(workspaceId, status) as Record<string, unknown>[]
      : this.db.query(`
          SELECT a.*
          FROM approvals a
          JOIN tasks t ON t.id = a.task_id
          WHERE t.workspace_id = ?
          ORDER BY a.created_at DESC
          LIMIT 500
        `).all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapApprovalRow);
  }

  listPendingApprovals(workspaceId: string): PendingApprovalRecord[] {
    const rows = this.db.prepare(`
      SELECT
        a.*,
        t.status AS task_status,
        t.runtime_id,
        t.timeout_ms,
        t.created_at AS task_created_at
      FROM approvals a
      JOIN tasks t ON t.id = a.task_id
      WHERE a.status = 'pending' AND t.workspace_id = ?
      ORDER BY a.created_at ASC
    `).all(workspaceId) as Array<Record<string, unknown>>;

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

  getApprovalInWorkspace(approvalId: string, workspaceId: string): ApprovalRecord | null {
    const row = this.db.query(`
      SELECT a.*
      FROM approvals a
      JOIN tasks t ON t.id = a.task_id
      WHERE a.id = ? AND t.workspace_id = ?
      LIMIT 1
    `).get(approvalId, workspaceId) as Record<string, unknown> | null;
    return row ? mapApprovalRow(row) : null;
  }

  bootstrapAnonymousSession(sessionId?: string): AnonymousContext {
    const now = Date.now();

    if (sessionId) {
      const existing = this.db.query(
        "SELECT * FROM anonymous_sessions WHERE session_id = ?",
      ).get(sessionId) as Record<string, unknown> | null;
      if (existing) {
        this.db.prepare(
          "UPDATE anonymous_sessions SET last_seen_at = ? WHERE session_id = ?",
        ).run(now, sessionId);
        const refreshed = this.db.query(
          "SELECT * FROM anonymous_sessions WHERE session_id = ?",
        ).get(sessionId) as Record<string, unknown>;
        return mapAnonymousContextRow(refreshed);
      }
    }

    const newSessionId = `anon_session_${crypto.randomUUID()}`;
    const workspaceId = `ws_${crypto.randomUUID()}`;
    const actorId = `anon_${crypto.randomUUID()}`;
    const clientId = "web";

    this.db.prepare(`
      INSERT INTO anonymous_sessions (
        session_id,
        workspace_id,
        actor_id,
        client_id,
        created_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(newSessionId, workspaceId, actorId, clientId, now, now);

    const row = this.db.query(
      "SELECT * FROM anonymous_sessions WHERE session_id = ?",
    ).get(newSessionId) as Record<string, unknown>;
    return mapAnonymousContextRow(row);
  }

  upsertAccessPolicy(params: {
    id?: string;
    workspaceId: string;
    actorId?: string;
    clientId?: string;
    toolPathPattern: string;
    decision: PolicyDecision;
    priority?: number;
  }): AccessPolicyRecord {
    const now = Date.now();
    const id = params.id ?? `policy_${crypto.randomUUID()}`;

    this.db.prepare(`
      INSERT INTO access_policies (
        id,
        workspace_id,
        actor_id,
        client_id,
        tool_path_pattern,
        decision,
        priority,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        actor_id = excluded.actor_id,
        client_id = excluded.client_id,
        tool_path_pattern = excluded.tool_path_pattern,
        decision = excluded.decision,
        priority = excluded.priority,
        updated_at = excluded.updated_at
    `).run(
      id,
      params.workspaceId,
      params.actorId ?? null,
      params.clientId ?? null,
      params.toolPathPattern,
      params.decision,
      params.priority ?? 100,
      now,
      now,
    );

    const row = this.db.query("SELECT * FROM access_policies WHERE id = ?").get(id) as
      | Record<string, unknown>
      | null;
    if (!row) {
      throw new Error(`Failed to read policy ${id}`);
    }
    return mapPolicyRow(row);
  }

  listAccessPolicies(workspaceId: string): AccessPolicyRecord[] {
    const rows = this.db.query(
      "SELECT * FROM access_policies WHERE workspace_id = ? ORDER BY priority DESC, created_at ASC",
    ).all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapPolicyRow);
  }

  upsertCredential(params: {
    id?: string;
    workspaceId: string;
    sourceKey: string;
    scope: CredentialScope;
    actorId?: string;
    secretJson: Record<string, unknown>;
  }): CredentialRecord {
    const now = Date.now();
    const actorId = params.scope === "actor" ? params.actorId ?? null : null;

    const existing = this.db.query(
      "SELECT id, created_at FROM source_credentials WHERE workspace_id = ? AND source_key = ? AND scope = ? AND COALESCE(actor_id, '') = COALESCE(?, '')",
    ).get(params.workspaceId, params.sourceKey, params.scope, actorId) as
      | { id: string; created_at: number }
      | null;

    if (existing) {
      this.db.prepare(`
        UPDATE source_credentials
        SET secret_json = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(params.secretJson), now, existing.id);
    } else {
      const id = params.id ?? `cred_${crypto.randomUUID()}`;
      this.db.prepare(`
        INSERT INTO source_credentials (
          id,
          workspace_id,
          source_key,
          scope,
          actor_id,
          secret_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.workspaceId,
        params.sourceKey,
        params.scope,
        actorId,
        JSON.stringify(params.secretJson),
        now,
        now,
      );
    }

    const row = this.db.query(
      "SELECT * FROM source_credentials WHERE workspace_id = ? AND source_key = ? AND scope = ? AND COALESCE(actor_id, '') = COALESCE(?, '')",
    ).get(params.workspaceId, params.sourceKey, params.scope, actorId) as Record<string, unknown> | null;
    if (!row) {
      throw new Error("Failed to read upserted credential");
    }
    return mapCredentialRow(row);
  }

  listCredentials(workspaceId: string): CredentialRecord[] {
    const rows = this.db.query(
      "SELECT * FROM source_credentials WHERE workspace_id = ? ORDER BY created_at DESC",
    ).all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapCredentialRow);
  }

  resolveCredential(params: {
    workspaceId: string;
    sourceKey: string;
    scope: CredentialScope;
    actorId?: string;
  }): CredentialRecord | null {
    if (params.scope === "actor") {
      if (!params.actorId) {
        return null;
      }
      const actorRow = this.db.query(
        "SELECT * FROM source_credentials WHERE workspace_id = ? AND source_key = ? AND scope = 'actor' AND actor_id = ?",
      ).get(params.workspaceId, params.sourceKey, params.actorId) as Record<string, unknown> | null;
      return actorRow ? mapCredentialRow(actorRow) : null;
    }

    const workspaceRow = this.db.query(
      "SELECT * FROM source_credentials WHERE workspace_id = ? AND source_key = ? AND scope = 'workspace' LIMIT 1",
    ).get(params.workspaceId, params.sourceKey) as Record<string, unknown> | null;
    return workspaceRow ? mapCredentialRow(workspaceRow) : null;
  }

  upsertToolSource(params: {
    id?: string;
    workspaceId: string;
    name: string;
    type: "mcp" | "openapi";
    config: Record<string, unknown>;
    enabled?: boolean;
  }): ToolSourceRecord {
    const now = Date.now();
    const id = params.id ?? `src_${crypto.randomUUID()}`;
    const existing = this.db.query("SELECT id, created_at FROM tool_sources WHERE id = ?").get(id) as
      | { id: string; created_at: number }
      | null;

    if (existing) {
      this.db.prepare(`
        UPDATE tool_sources
        SET workspace_id = ?, name = ?, type = ?, config_json = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        params.workspaceId,
        params.name,
        params.type,
        JSON.stringify(params.config),
        params.enabled === false ? 0 : 1,
        now,
        id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO tool_sources (
          id,
          workspace_id,
          name,
          type,
          config_json,
          enabled,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.workspaceId,
        params.name,
        params.type,
        JSON.stringify(params.config),
        params.enabled === false ? 0 : 1,
        now,
        now,
      );
    }

    const row = this.db.query("SELECT * FROM tool_sources WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) {
      throw new Error(`Failed to read tool source ${id}`);
    }
    return mapToolSourceRow(row);
  }

  listToolSources(workspaceId: string): ToolSourceRecord[] {
    const rows = this.db.query(
      "SELECT * FROM tool_sources WHERE workspace_id = ? ORDER BY updated_at DESC",
    ).all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapToolSourceRow);
  }

  deleteToolSource(workspaceId: string, sourceId: string): boolean {
    const result = this.db.query(
      "DELETE FROM tool_sources WHERE workspace_id = ? AND id = ?",
    ).run(workspaceId, sourceId);
    return Number(result.changes ?? 0) > 0;
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
