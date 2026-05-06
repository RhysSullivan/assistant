// End-to-end test for the mcp portion of
// `0007_normalize_plugin_secret_refs.sql`. Seeds an mcp_source row
// with the legacy json shape (config containing auth/headers/
// queryParams), runs the migration runner, asserts the auth columns
// are populated and the child tables hold the secret-backed entries.

import { afterEach, describe, expect, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Schema } from "effect";

import { PRE_0007_SQL, stampPriorMigrationsApplied } from "./__test-helpers__/pre-0007-schema";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "../../drizzle");

const ConfigJson = Schema.fromJsonString(
  Schema.Struct({
    auth: Schema.optional(Schema.Unknown),
    command: Schema.optional(Schema.String),
    endpoint: Schema.optional(Schema.String),
    transport: Schema.String,
  }),
);

const tempDirs: Array<string> = [];

const makeDbPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-mig-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
};

describe("0007_normalize_plugin_secret_refs (mcp)", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flattens header auth into auth_kind/auth_secret_id columns", () => {
    const dbPath = makeDbPath();
    const db = new Database(dbPath);
    db.exec(PRE_0007_SQL);
    stampPriorMigrationsApplied(db);

    db.prepare(
      "INSERT INTO mcp_source (scope_id, id, name, config, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "default-scope",
      "remote-headers",
      "Remote Headers",
      JSON.stringify({
        transport: "remote",
        endpoint: "https://example.com/mcp",
        auth: {
          kind: "header",
          headerName: "X-API-Key",
          secretId: "tok-secret",
          prefix: "Bearer ",
        },
      }),
      Date.now(),
    );

    db.close();
    const drizzleDb = drizzle(new Database(dbPath));
    migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    const after = new Database(dbPath, { readonly: true });
    const row = after
      .prepare(
        "SELECT auth_kind, auth_header_name, auth_secret_id, auth_secret_prefix, config FROM mcp_source WHERE id = ?",
      )
      .get("remote-headers") as {
      auth_kind: string;
      auth_header_name: string;
      auth_secret_id: string;
      auth_secret_prefix: string;
      config: string;
    };
    expect(row.auth_kind).toBe("header");
    expect(row.auth_header_name).toBe("X-API-Key");
    expect(row.auth_secret_id).toBe("tok-secret");
    expect(row.auth_secret_prefix).toBe("Bearer ");
    // The auth key should be stripped from config json after migration.
    const config = Schema.decodeUnknownSync(ConfigJson)(row.config);
    expect(config.auth).toBeUndefined();
    expect(config.transport).toBe("remote");
    expect(config.endpoint).toBe("https://example.com/mcp");
    after.close();
  });

  it("flattens oauth2 auth and explodes headers into child rows", () => {
    const dbPath = makeDbPath();
    const db = new Database(dbPath);
    db.exec(PRE_0007_SQL);
    stampPriorMigrationsApplied(db);

    db.prepare(
      "INSERT INTO mcp_source (scope_id, id, name, config, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "default-scope",
      "remote-oauth",
      "Remote OAuth",
      JSON.stringify({
        transport: "remote",
        endpoint: "https://oauth.example/mcp",
        headers: {
          "X-Trace": "static",
          "X-Token": { secretId: "extra-tok" },
        },
        queryParams: {
          org: { secretId: "org-id-secret" },
        },
        auth: {
          kind: "oauth2",
          connectionId: "conn-1",
          clientIdSecretId: "client-id-sec",
          clientSecretSecretId: "client-secret-sec",
        },
      }),
      Date.now(),
    );

    db.close();
    const drizzleDb = drizzle(new Database(dbPath));
    migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    const after = new Database(dbPath, { readonly: true });
    const row = after
      .prepare(
        "SELECT auth_kind, auth_connection_id, auth_client_id_secret_id, auth_client_secret_secret_id FROM mcp_source WHERE id = ?",
      )
      .get("remote-oauth") as Record<string, string | null>;
    expect(row.auth_kind).toBe("oauth2");
    expect(row.auth_connection_id).toBe("conn-1");
    expect(row.auth_client_id_secret_id).toBe("client-id-sec");
    expect(row.auth_client_secret_secret_id).toBe("client-secret-sec");

    const headers = after
      .prepare(
        "SELECT name, kind, text_value, secret_id FROM mcp_source_header WHERE source_id = ? ORDER BY name",
      )
      .all("remote-oauth") as ReadonlyArray<Record<string, string | null>>;
    expect(headers).toHaveLength(2);
    const byName = new Map(headers.map((h) => [h.name, h]));
    expect(byName.get("X-Trace")).toMatchObject({
      kind: "text",
      text_value: "static",
    });
    expect(byName.get("X-Token")).toMatchObject({
      kind: "secret",
      secret_id: "extra-tok",
    });

    const params = after
      .prepare("SELECT name, secret_id FROM mcp_source_query_param WHERE source_id = ?")
      .all("remote-oauth") as ReadonlyArray<Record<string, string>>;
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ name: "org", secret_id: "org-id-secret" });

    after.close();
  });

  it("leaves stdio sources alone (no auth, no headers, no queryParams)", () => {
    const dbPath = makeDbPath();
    const db = new Database(dbPath);
    db.exec(PRE_0007_SQL);
    stampPriorMigrationsApplied(db);

    db.prepare(
      "INSERT INTO mcp_source (scope_id, id, name, config, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "default-scope",
      "stdio-only",
      "Stdio",
      JSON.stringify({
        transport: "stdio",
        command: "/usr/bin/server",
        args: ["--flag"],
      }),
      Date.now(),
    );

    db.close();
    const drizzleDb = drizzle(new Database(dbPath));
    migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    const after = new Database(dbPath, { readonly: true });
    const row = after
      .prepare("SELECT auth_kind, auth_secret_id, config FROM mcp_source WHERE id = ?")
      .get("stdio-only") as {
      auth_kind: string;
      auth_secret_id: string | null;
      config: string;
    };
    expect(row.auth_kind).toBe("none");
    expect(row.auth_secret_id).toBeNull();
    const config = Schema.decodeUnknownSync(ConfigJson)(row.config);
    expect(config.transport).toBe("stdio");
    expect(config.command).toBe("/usr/bin/server");
    after.close();
  });
});
