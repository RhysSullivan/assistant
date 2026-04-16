// Upgrade path for local DBs written by pre-scope executor versions.
//
// These tests exercise both halves:
//   1. The detector correctly identifies DBs missing the `scope_id`
//      column on `source`.
//   2. The move-aside helper renames the file (plus WAL/SHM siblings)
//      so a subsequent fresh `migrate()` can create the new shape.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { isPreScopeSchema, moveAsidePreScopeDb } from "./db-upgrade";

const PRE_SCOPE_SCHEMA = `
  CREATE TABLE source (
    id TEXT PRIMARY KEY NOT NULL,
    plugin_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    can_remove INTEGER DEFAULT 1 NOT NULL,
    can_refresh INTEGER DEFAULT 0 NOT NULL,
    can_edit INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE tool (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE blob (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
  );
`;

const SCOPED_SCHEMA = `
  CREATE TABLE source (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    can_remove INTEGER DEFAULT 1 NOT NULL,
    can_refresh INTEGER DEFAULT 0 NOT NULL,
    can_edit INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope_id, id)
  );
`;

const seed = (path: string, sql: string) => {
  const db = new Database(path);
  db.exec(sql);
  db.close();
};

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "exec-dbup-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("isPreScopeSchema", () => {
  it("returns true for a DB with a source table missing scope_id", () => {
    const path = join(workDir, "data.db");
    seed(path, PRE_SCOPE_SCHEMA);
    expect(isPreScopeSchema(path)).toBe(true);
  });

  it("returns false for a DB whose source table already has scope_id", () => {
    const path = join(workDir, "data.db");
    seed(path, SCOPED_SCHEMA);
    expect(isPreScopeSchema(path)).toBe(false);
  });

  it("returns false for a DB with no source table", () => {
    const path = join(workDir, "data.db");
    seed(path, "CREATE TABLE unrelated (x TEXT);");
    expect(isPreScopeSchema(path)).toBe(false);
  });

  it("returns false when the DB file doesn't exist", () => {
    expect(isPreScopeSchema(join(workDir, "missing.db"))).toBe(false);
  });
});

describe("moveAsidePreScopeDb", () => {
  it("renames data.db + wal/shm siblings and returns the backup path", () => {
    const path = join(workDir, "data.db");
    seed(path, PRE_SCOPE_SCHEMA);
    writeFileSync(`${path}-wal`, "wal-bytes");
    writeFileSync(`${path}-shm`, "shm-bytes");

    const backup = moveAsidePreScopeDb(path);
    expect(backup).toMatch(/data\.db\.pre-scopes-\d+$/);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
    expect(existsSync(backup!)).toBe(true);
    expect(existsSync(`${backup}-wal`)).toBe(true);
    expect(existsSync(`${backup}-shm`)).toBe(true);
  });

  it("is a no-op when the DB already has the scoped schema", () => {
    const path = join(workDir, "data.db");
    seed(path, SCOPED_SCHEMA);
    expect(moveAsidePreScopeDb(path)).toBeNull();
    expect(existsSync(path)).toBe(true);
  });

  it("is a no-op when the DB doesn't exist yet (fresh install)", () => {
    expect(moveAsidePreScopeDb(join(workDir, "missing.db"))).toBeNull();
  });
});

// Integration: the whole reason this helper exists — a pre-scope DB
// must be recoverable via fresh drizzle migrations after the move.
describe("move-aside + fresh migrate end-to-end", () => {
  it("lets migrations run cleanly after an old DB is moved aside", () => {
    const path = join(workDir, "data.db");
    seed(path, PRE_SCOPE_SCHEMA);

    const backup = moveAsidePreScopeDb(path);
    expect(backup).not.toBeNull();

    const db = new Database(path);
    migrate(drizzle(db), {
      migrationsFolder: join(__dirname, "../../drizzle"),
    });
    // migrate() should have produced the new schema — source now has scope_id.
    const cols = db
      .prepare("PRAGMA table_info('source')")
      .all() as ReadonlyArray<{ readonly name: string }>;
    expect(cols.some((c) => c.name === "scope_id")).toBe(true);
    db.close();
  });
});
