// ---------------------------------------------------------------------------
// Out-of-band migration runner for @executor/cloud
// ---------------------------------------------------------------------------
//
// Applies the postgres schema (core + plugin tables, plus the blob table)
// to the database pointed at by $DATABASE_URL. Run from CI or locally —
// NEVER from the Worker request path.
//
//   DATABASE_URL=postgres://... bun apps/cloud/scripts/migrate.ts
//
// The plugin list is a DELIBERATE duplicate of the one in
// apps/cloud/src/services/executor.ts. We can't import that module from
// Bun because it transitively imports `cloudflare:workers`, which only
// resolves inside the Workers runtime. Keep the two lists in sync when
// adding/removing plugins from the cloud app.

import { Effect } from "effect";
import postgres from "postgres";

import { collectSchemas } from "@executor/sdk";
import { runPostgresMigrations } from "@executor/storage-postgres";

import { openApiPlugin } from "@executor/plugin-openapi";
import { mcpPlugin } from "@executor/plugin-mcp";
import { graphqlPlugin } from "@executor/plugin-graphql";
import { workosVaultPlugin } from "@executor/plugin-workos-vault";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

// Credentials are never exercised: `collectSchemas` only reads
// `plugin.schema`, it does not call `secretProviders` or otherwise
// contact WorkOS. We still have to pass something so the factory
// doesn't throw.
const plugins = [
  openApiPlugin(),
  mcpPlugin({ dangerouslyAllowStdioMCP: false }),
  graphqlPlugin(),
  workosVaultPlugin({
    credentials: {
      apiKey: "migrate-noop",
      clientId: "migrate-noop",
    },
  }),
] as const;

const schema = collectSchemas(plugins);

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 0,
  max_lifetime: 60,
  connect_timeout: 10,
  onnotice: () => undefined,
});

const program = Effect.gen(function* () {
  yield* runPostgresMigrations({ sql, schema });
});

let exitCode = 0;
try {
  await Effect.runPromise(program);
  console.log("[migrate] OK");
} catch (error) {
  console.error("[migrate] FAILED:", error);
  exitCode = 1;
}

await sql.end({ timeout: 5 }).catch(() => undefined);
process.exit(exitCode);
