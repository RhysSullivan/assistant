// End-to-end test for `0008_normalize_openapi.sql`. Seeds the
// pre-migration shape (json blobs on openapi_source.query_params,
// openapi_source.invocation_config.specFetchCredentials.*, and
// openapi_source_binding.value), runs the migration runner, asserts
// the new flat columns + child tables match.

import { describe, expect, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "../../drizzle");

// Pre-0008 shape — only the openapi tables we touch, plus the drizzle
// bookkeeping table so the runner can stamp earlier migrations as
// applied and only run 0008.
const PRE_0008_SQL = `
  CREATE TABLE __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at NUMERIC
  );

  CREATE TABLE openapi_source (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    name TEXT NOT NULL,
    spec TEXT NOT NULL,
    source_url TEXT,
    base_url TEXT,
    headers TEXT,
    query_params TEXT,
    oauth2 TEXT,
    invocation_config TEXT NOT NULL,
    PRIMARY KEY (scope_id, id)
  );

  CREATE TABLE openapi_operation (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    binding TEXT NOT NULL,
    PRIMARY KEY (scope_id, id)
  );

  CREATE TABLE openapi_source_binding (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL,
    source_scope_id TEXT NOT NULL,
    target_scope_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE mcp_source (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (scope_id, id)
  );

  CREATE TABLE mcp_binding (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    binding TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (scope_id, id)
  );

  CREATE TABLE google_discovery_source (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope_id, id)
  );

  CREATE TABLE google_discovery_binding (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    binding TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (scope_id, id)
  );
`;

// Stamp 0007's folderMillis from the journal so drizzle's runner skips
// 0000..0007 and only executes 0008+ against this hand-seeded DB.
const STAMP_BEFORE = 1778100000000; // 0007_normalize_graphql.when

const stampPriorMigrationsApplied = (db: Database) => {
  db.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  ).run("pre-0008-marker", STAMP_BEFORE);
};

describe("0008_normalize_openapi backfill", () => {
  it("flattens openapi_source_binding.value into kind/secret_id/connection_id/text_value", () => {
    const dir = mkdtempSync(join(tmpdir(), "openapi-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0008_SQL);
      stampPriorMigrationsApplied(db);

      // Seed three bindings, one per kind.
      const insert = db.prepare(
        "INSERT INTO openapi_source_binding (id, source_id, source_scope_id, target_scope_id, slot, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const now = Date.now();
      insert.run(
        "b1",
        "src",
        "default-scope",
        "default-scope",
        "header:authorization",
        JSON.stringify({ kind: "secret", secretId: "tok-secret" }),
        now,
        now,
      );
      insert.run(
        "b2",
        "src",
        "default-scope",
        "default-scope",
        "oauth2:default:connection",
        JSON.stringify({ kind: "connection", connectionId: "conn-1" }),
        now,
        now,
      );
      insert.run(
        "b3",
        "src",
        "default-scope",
        "default-scope",
        "header:x-static",
        JSON.stringify({ kind: "text", text: "literal" }),
        now,
        now,
      );

      // Need the parent openapi_source row so the source_id FK ergonomics
      // are satisfied for any cascading delete logic — though the binding
      // table has no DB-level FK, code paths assume the parent exists.
      db.prepare(
        "INSERT INTO openapi_source (scope_id, id, name, spec, invocation_config) VALUES (?, ?, ?, ?, ?)",
      ).run("default-scope", "src", "Source", "{}", "{}");

      db.close();

      const drizzleDb = drizzle(new Database(dbPath));
      migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

      const after = new Database(dbPath, { readonly: true });
      const rows = after
        .prepare(
          "SELECT id, kind, secret_id, connection_id, text_value FROM openapi_source_binding ORDER BY id",
        )
        .all() as ReadonlyArray<{
        id: string;
        kind: string;
        secret_id: string | null;
        connection_id: string | null;
        text_value: string | null;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        id: "b1",
        kind: "secret",
        secret_id: "tok-secret",
        connection_id: null,
        text_value: null,
      });
      expect(rows[1]).toMatchObject({
        id: "b2",
        kind: "connection",
        secret_id: null,
        connection_id: "conn-1",
        text_value: null,
      });
      expect(rows[2]).toMatchObject({
        id: "b3",
        kind: "text",
        secret_id: null,
        connection_id: null,
        text_value: "literal",
      });
      // value json column dropped.
      const cols = after
        .prepare("PRAGMA table_info('openapi_source_binding')")
        .all() as ReadonlyArray<{ name: string }>;
      expect(cols.some((c) => c.name === "value")).toBe(false);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explodes query_params and specFetchCredentials json into child rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "openapi-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0008_SQL);
      stampPriorMigrationsApplied(db);

      const queryParams = {
        api_key: { secretId: "qp-secret" },
        flag: "true",
      };
      const invocationConfig = {
        specFetchCredentials: {
          headers: {
            Authorization: { secretId: "fetch-tok", prefix: "Bearer " },
          },
          queryParams: { token: { secretId: "fetch-qp" } },
        },
      };

      db.prepare(
        "INSERT INTO openapi_source (scope_id, id, name, spec, query_params, invocation_config) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        "default-scope",
        "src",
        "Source",
        "{}",
        JSON.stringify(queryParams),
        JSON.stringify(invocationConfig),
      );

      db.close();

      const drizzleDb = drizzle(new Database(dbPath));
      migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

      const after = new Database(dbPath, { readonly: true });

      const qpRows = after
        .prepare(
          "SELECT name, kind, text_value, secret_id FROM openapi_source_query_param WHERE source_id = ? ORDER BY name",
        )
        .all("src") as ReadonlyArray<{
        name: string;
        kind: string;
        text_value: string | null;
        secret_id: string | null;
      }>;
      expect(qpRows).toHaveLength(2);
      const byName = new Map(qpRows.map((r) => [r.name, r]));
      expect(byName.get("api_key")).toMatchObject({
        kind: "secret",
        secret_id: "qp-secret",
      });
      expect(byName.get("flag")).toMatchObject({
        kind: "text",
        text_value: "true",
      });

      const fetchHeaders = after
        .prepare(
          "SELECT name, kind, secret_id, secret_prefix FROM openapi_source_spec_fetch_header WHERE source_id = ?",
        )
        .all("src") as ReadonlyArray<{
        name: string;
        kind: string;
        secret_id: string | null;
        secret_prefix: string | null;
      }>;
      expect(fetchHeaders).toHaveLength(1);
      expect(fetchHeaders[0]).toMatchObject({
        name: "Authorization",
        kind: "secret",
        secret_id: "fetch-tok",
        secret_prefix: "Bearer ",
      });

      const fetchQp = after
        .prepare(
          "SELECT name, secret_id FROM openapi_source_spec_fetch_query_param WHERE source_id = ?",
        )
        .all("src") as ReadonlyArray<{ name: string; secret_id: string }>;
      expect(fetchQp).toHaveLength(1);
      expect(fetchQp[0]).toMatchObject({ name: "token", secret_id: "fetch-qp" });

      // Old json columns dropped.
      const cols = after
        .prepare("PRAGMA table_info('openapi_source')")
        .all() as ReadonlyArray<{ name: string }>;
      expect(cols.some((c) => c.name === "query_params")).toBe(false);
      expect(cols.some((c) => c.name === "invocation_config")).toBe(false);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives empty / missing json on bindings and sources", () => {
    const dir = mkdtempSync(join(tmpdir(), "openapi-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0008_SQL);
      stampPriorMigrationsApplied(db);

      // Source with empty invocation_config and no query_params.
      db.prepare(
        "INSERT INTO openapi_source (scope_id, id, name, spec, invocation_config) VALUES (?, ?, ?, ?, ?)",
      ).run("default-scope", "bare", "Bare", "{}", JSON.stringify({}));

      db.close();
      const drizzleDb = drizzle(new Database(dbPath));
      migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

      const after = new Database(dbPath, { readonly: true });
      const qpCount = (
        after
          .prepare(
            "SELECT count(*) as n FROM openapi_source_query_param WHERE source_id = ?",
          )
          .get("bare") as { n: number }
      ).n;
      expect(qpCount).toBe(0);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
