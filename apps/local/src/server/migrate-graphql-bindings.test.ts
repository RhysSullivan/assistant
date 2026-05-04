// End-to-end test for `0007_normalize_graphql.sql`: seed a DB at the
// pre-migration (0006) shape with json-blob headers/query_params/auth,
// run the migration, assert that the JSON unpacks into the new
// normalized columns / child tables and that the JSON columns are gone.

import { describe, expect, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "../../drizzle");

// Minimal pre-migration shape — the graphql tables we care about,
// plus the openapi tables that 0008 (which also runs after our stamp)
// needs to touch, plus the drizzle bookkeeping `__drizzle_migrations`
// table that the runner uses to skip already-applied migrations. Both
// 0007 and 0008 will run sequentially against this DB; the test only
// asserts on the graphql side.
const PRE_0007_SQL = `
  CREATE TABLE __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at NUMERIC
  );

  CREATE TABLE graphql_source (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    headers TEXT,
    query_params TEXT,
    auth TEXT,
    PRIMARY KEY (scope_id, id)
  );

  CREATE TABLE graphql_operation (
    id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    binding TEXT NOT NULL,
    PRIMARY KEY (scope_id, id)
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
`;

// drizzle's sqlite migrator picks the latest `created_at` from
// __drizzle_migrations and skips any migration whose folderMillis (from
// the journal) is <= that timestamp. Stamping a row with 0006's
// folderMillis lets the runner skip 0000..0006 and only execute 0007.
const STAMP_BEFORE = 1777850000001; // 0006_neat_terror.when

const stampPriorMigrationsApplied = (db: Database) => {
  db.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  ).run("pre-0007-marker", STAMP_BEFORE);
};

describe("0007_normalize_graphql backfill", () => {
  it("flattens auth json into auth_kind/auth_connection_id columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "graphql-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0007_SQL);
      stampPriorMigrationsApplied(db);

      db.prepare(
        "INSERT INTO graphql_source (scope_id, id, name, endpoint, auth) VALUES (?, ?, ?, ?, ?)",
      ).run(
        "default-scope",
        "github",
        "GitHub",
        "https://api.github.com/graphql",
        JSON.stringify({ kind: "oauth2", connectionId: "conn-1" }),
      );

      db.close();

      const drizzleDb = drizzle(new Database(dbPath));
      migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

      const after = new Database(dbPath, { readonly: true });
      const row = after
        .prepare(
          "SELECT auth_kind, auth_connection_id FROM graphql_source WHERE id = ?",
        )
        .get("github") as { auth_kind: string; auth_connection_id: string };
      expect(row.auth_kind).toBe("oauth2");
      expect(row.auth_connection_id).toBe("conn-1");
      // Old json column is gone.
      const cols = after
        .prepare("PRAGMA table_info('graphql_source')")
        .all() as ReadonlyArray<{ name: string }>;
      expect(cols.some((c) => c.name === "auth")).toBe(false);
      expect(cols.some((c) => c.name === "headers")).toBe(false);
      expect(cols.some((c) => c.name === "query_params")).toBe(false);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explodes header/query_param json into child rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "graphql-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0007_SQL);
      stampPriorMigrationsApplied(db);

      const headers = {
        // Literal text header.
        "X-Static": "literal-value",
        // Secret-backed header without prefix.
        Authorization: { secretId: "sec-token" },
        // Secret-backed with prefix.
        "X-Bearer": { secretId: "sec-bearer", prefix: "Bearer " },
      };
      const queryParams = {
        api_key: { secretId: "sec-key" },
      };

      db.prepare(
        "INSERT INTO graphql_source (scope_id, id, name, endpoint, headers, query_params, auth) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "default-scope",
        "example",
        "Example",
        "https://example.com/graphql",
        JSON.stringify(headers),
        JSON.stringify(queryParams),
        JSON.stringify({ kind: "none" }),
      );

      db.close();

      const drizzleDb = drizzle(new Database(dbPath));
      migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

      const after = new Database(dbPath, { readonly: true });
      const headerRows = after
        .prepare(
          "SELECT name, kind, text_value, secret_id, secret_prefix FROM graphql_source_header WHERE source_id = ? ORDER BY name",
        )
        .all("example") as ReadonlyArray<{
        name: string;
        kind: string;
        text_value: string | null;
        secret_id: string | null;
        secret_prefix: string | null;
      }>;
      expect(headerRows).toHaveLength(3);

      const byName = new Map(headerRows.map((r) => [r.name, r]));
      expect(byName.get("X-Static")).toMatchObject({
        kind: "text",
        text_value: "literal-value",
        secret_id: null,
      });
      expect(byName.get("Authorization")).toMatchObject({
        kind: "secret",
        text_value: null,
        secret_id: "sec-token",
        secret_prefix: null,
      });
      expect(byName.get("X-Bearer")).toMatchObject({
        kind: "secret",
        secret_id: "sec-bearer",
        secret_prefix: "Bearer ",
      });

      const paramRow = after
        .prepare(
          "SELECT kind, secret_id FROM graphql_source_query_param WHERE source_id = ?",
        )
        .get("example") as { kind: string; secret_id: string };
      expect(paramRow).toMatchObject({ kind: "secret", secret_id: "sec-key" });

      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles graphql_source rows with null json (empty config)", () => {
    const dir = mkdtempSync(join(tmpdir(), "graphql-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0007_SQL);
      stampPriorMigrationsApplied(db);

      db.prepare(
        "INSERT INTO graphql_source (scope_id, id, name, endpoint) VALUES (?, ?, ?, ?)",
      ).run("default-scope", "bare", "Bare", "https://bare.example/graphql");
      db.close();

      const drizzleDb = drizzle(new Database(dbPath));
      migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

      const after = new Database(dbPath, { readonly: true });
      const row = after
        .prepare(
          "SELECT auth_kind, auth_connection_id FROM graphql_source WHERE id = ?",
        )
        .get("bare") as { auth_kind: string; auth_connection_id: string | null };
      expect(row.auth_kind).toBe("none");
      expect(row.auth_connection_id).toBeNull();

      const headerCount = (
        after
          .prepare(
            "SELECT count(*) as n FROM graphql_source_header WHERE source_id = ?",
          )
          .get("bare") as { n: number }
      ).n;
      expect(headerCount).toBe(0);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not collapse child rows whose source/name pairs share colon-concatenated ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "graphql-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0007_SQL);
      stampPriorMigrationsApplied(db);

      const insert = db.prepare(
        "INSERT INTO graphql_source (scope_id, id, name, endpoint, headers) VALUES (?, ?, ?, ?, ?)",
      );
      insert.run(
        "default-scope",
        "a:b",
        "First",
        "https://first.example/graphql",
        JSON.stringify({ c: "first" }),
      );
      insert.run(
        "default-scope",
        "a",
        "Second",
        "https://second.example/graphql",
        JSON.stringify({ "b:c": "second" }),
      );
      db.close();

      const drizzleDb = drizzle(new Database(dbPath));
      migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

      const after = new Database(dbPath, { readonly: true });
      const rows = after
        .prepare(
          "SELECT id, source_id, name, text_value FROM graphql_source_header ORDER BY source_id, name",
        )
        .all() as ReadonlyArray<{
        id: string;
        source_id: string;
        name: string;
        text_value: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows).toEqual([
        {
          id: '["a","b:c"]',
          source_id: "a",
          name: "b:c",
          text_value: "second",
        },
        {
          id: '["a:b","c"]',
          source_id: "a:b",
          name: "c",
          text_value: "first",
        },
      ]);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
