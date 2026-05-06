import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateLegacyConnections } from "./migrate-connections";

let workDir: string;
let databases: Array<Database>;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "executor-migrate-connections-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  rmSync(workDir, { recursive: true, force: true });
});

const openDatabase = (): Database => {
  const db = new Database(join(workDir, "data.db"));
  databases.push(db);
  return db;
};

const columnNames = (db: Database, table: string): ReadonlyArray<string> =>
  (
    db.prepare(`PRAGMA table_info('${table}')`).all() as ReadonlyArray<{
      readonly name: string;
    }>
  ).map((column) => column.name);

const MigratedMcpConfig = Schema.Struct({
  auth: Schema.optional(Schema.Unknown),
});
const decodeMigratedMcpConfig = Schema.decodeUnknownSync(
  Schema.fromJsonString(MigratedMcpConfig),
);

const MigratedOpenApiOAuth2 = Schema.Struct({
  kind: Schema.Literal("oauth2"),
  connectionId: Schema.String,
});
const decodeMigratedOpenApiOAuth2 = Schema.decodeUnknownSync(
  Schema.fromJsonString(MigratedOpenApiOAuth2),
);

describe("migrateLegacyConnections", () => {
  it("backfills legacy MCP OAuth rows after connection.kind has been dropped", async () => {
    const db = openDatabase();
    migrate(drizzle(db), {
      migrationsFolder: join(import.meta.dirname, "../../drizzle"),
    });

    expect(columnNames(db, "connection")).not.toContain("kind");

    const now = Date.now();
    db.prepare(
      "INSERT INTO secret (scope_id, id, name, provider, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("scope-1", "access-token", "Access token", "keychain", now);
    db.prepare(
      "INSERT INTO secret (scope_id, id, name, provider, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("scope-1", "refresh-token", "Refresh token", "keychain", now);
    db.prepare(
      "INSERT INTO mcp_source (scope_id, id, name, config, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "scope-1",
      "remote-mcp",
      "Remote MCP",
      JSON.stringify({
        transport: "remote",
        endpoint: "https://example.com/mcp",
        auth: {
          kind: "oauth2",
          accessTokenSecretId: "access-token",
          refreshTokenSecretId: "refresh-token",
          tokenType: "Bearer",
          expiresAt: null,
          scope: "read",
          clientInformation: null,
          authorizationServerUrl: null,
          resourceMetadataUrl: null,
        },
      }),
      now,
    );

    await migrateLegacyConnections(db);

    const connection = db
      .prepare(
        "SELECT id, provider, access_token_secret_id, refresh_token_secret_id FROM connection WHERE scope_id = ?",
      )
      .get("scope-1") as
      | {
          readonly id: string;
          readonly provider: string;
          readonly access_token_secret_id: string;
          readonly refresh_token_secret_id: string | null;
        }
      | undefined;
    expect(connection).toEqual({
      id: "mcp-oauth2-remote-mcp",
      provider: "mcp:oauth2",
      access_token_secret_id: "access-token",
      refresh_token_secret_id: "refresh-token",
    });

    // Post-0009 the canonical auth lives in dedicated columns. The
    // legacy migrator strips config.auth and writes the new pointer to
    // auth_kind / auth_connection_id directly.
    const source = db
      .prepare(
        "SELECT config, auth_kind, auth_connection_id FROM mcp_source WHERE scope_id = ? AND id = ?",
      )
      .get("scope-1", "remote-mcp") as {
      readonly config: string;
      readonly auth_kind: string;
      readonly auth_connection_id: string;
    };
    expect(decodeMigratedMcpConfig(source.config).auth).toBeUndefined();
    expect(source.auth_kind).toBe("oauth2");
    expect(source.auth_connection_id).toBe("mcp-oauth2-remote-mcp");

    const ownedSecrets = db
      .prepare(
        "SELECT id, owned_by_connection_id FROM secret WHERE scope_id = ? ORDER BY id",
      )
      .all("scope-1");
    expect(ownedSecrets).toEqual([
      {
        id: "access-token",
        owned_by_connection_id: "mcp-oauth2-remote-mcp",
      },
      {
        id: "refresh-token",
        owned_by_connection_id: "mcp-oauth2-remote-mcp",
      },
    ]);
  });

  it("backfills legacy OpenAPI OAuth from oauth2 column after invocation_config has been dropped", async () => {
    const db = openDatabase();
    migrate(drizzle(db), {
      migrationsFolder: join(import.meta.dirname, "../../drizzle"),
    });

    expect(columnNames(db, "openapi_source")).not.toContain("invocation_config");

    const now = Date.now();
    db.prepare(
      "INSERT INTO secret (scope_id, id, name, provider, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("scope-1", "client-id", "Client ID", "keychain", now);
    db.prepare(
      "INSERT INTO secret (scope_id, id, name, provider, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("scope-1", "client-secret", "Client secret", "keychain", now);
    db.prepare(
      "INSERT INTO secret (scope_id, id, name, provider, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("scope-1", "access-token", "Access token", "keychain", now);

    db.prepare(
      "INSERT INTO openapi_source (scope_id, id, name, spec, oauth2) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "scope-1",
      "legacy-openapi",
      "Legacy OpenAPI",
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Legacy", version: "1" },
        paths: {},
        components: {
          securitySchemes: {
            oauth2: {
              type: "oauth2",
              flows: {
                clientCredentials: {
                  tokenUrl: "https://example.com/oauth/token",
                  scopes: { read: "read" },
                },
              },
            },
          },
        },
      }),
      JSON.stringify({
        kind: "oauth2",
        securitySchemeName: "oauth2",
        flow: "clientCredentials",
        tokenUrl: "https://example.com/oauth/token",
        clientIdSecretId: "client-id",
        clientSecretSecretId: "client-secret",
        accessTokenSecretId: "access-token",
        refreshTokenSecretId: null,
        tokenType: "Bearer",
        expiresAt: null,
        scope: "read",
        scopes: ["read"],
      }),
    );

    await migrateLegacyConnections(db);

    const connection = db
      .prepare(
        "SELECT id, provider, access_token_secret_id FROM connection WHERE scope_id = ?",
      )
      .get("scope-1") as
      | { readonly id: string; readonly provider: string; readonly access_token_secret_id: string }
      | undefined;
    expect(connection?.provider).toBe("openapi:oauth2");
    expect(connection?.access_token_secret_id).toBe("access-token");

    // The oauth2 column should now hold the new pointer shape with connectionId.
    const source = db
      .prepare("SELECT oauth2 FROM openapi_source WHERE scope_id = ? AND id = ?")
      .get("scope-1", "legacy-openapi") as { readonly oauth2: string };
    const oauth2 = decodeMigratedOpenApiOAuth2(source.oauth2);
    expect(oauth2.kind).toBe("oauth2");
    expect(oauth2.connectionId).toBe(connection?.id);
  });
});
