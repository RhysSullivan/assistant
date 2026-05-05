// End-to-end test for the openapi portion of
// `0007_normalize_plugin_secret_refs.sql`. Seeds the pre-migration
// shape (json blobs on openapi_source.query_params,
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

import { PRE_0007_SQL, stampPriorMigrationsApplied } from "./__test-helpers__/pre-0007-schema";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "../../drizzle");

describe("0007_normalize_plugin_secret_refs (openapi)", () => {
  it("flattens openapi_source_binding.value into kind/secret_id/connection_id/text_value", () => {
    const dir = mkdtempSync(join(tmpdir(), "openapi-mig-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = new Database(dbPath);
      db.exec(PRE_0007_SQL);
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
      db.exec(PRE_0007_SQL);
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
      db.exec(PRE_0007_SQL);
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
