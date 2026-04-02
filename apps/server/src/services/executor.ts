import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as SqlClient from "@effect/sql/SqlClient";
import * as fs from "node:fs";

import { createExecutor, scopeKv } from "@executor/sdk";
import { makeSqliteKv, makeKvConfig, migrate } from "@executor/storage-file";
import { openApiPlugin, makeKvOperationStore, type OpenApiPluginExtension } from "@executor/plugin-openapi";
import { mcpPlugin, makeKvBindingStore, type McpPluginExtension } from "@executor/plugin-mcp";
import { keychainPlugin } from "@executor/plugin-keychain";
import { fileSecretsPlugin } from "@executor/plugin-file-secrets";
import { onepasswordPlugin, type OnePasswordExtension } from "@executor/plugin-onepassword";

import type { Executor, ExecutorPlugin } from "@executor/sdk";

type ServerPlugins = readonly [
  ExecutorPlugin<"openapi", OpenApiPluginExtension>,
  ExecutorPlugin<"mcp", McpPluginExtension>,
  ReturnType<typeof keychainPlugin>,
  ReturnType<typeof fileSecretsPlugin>,
  ExecutorPlugin<"onepassword", OnePasswordExtension>,
];
export type ServerExecutor = Executor<ServerPlugins>;

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class ExecutorService extends Context.Tag("ExecutorService")<
  ExecutorService,
  ServerExecutor
>() {}

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.EXECUTOR_DATA_DIR
  ?? `${import.meta.dirname}/../../../../.executor-data`;

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = `${DATA_DIR}/data.db`;

// ---------------------------------------------------------------------------
// Executor Layer — SQLite-backed, scoped to ManagedRuntime lifetime
// ---------------------------------------------------------------------------

const ExecutorLayer = Layer.effect(
  ExecutorService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* migrate.pipe(Effect.catchAll((e) => Effect.die(e)));

    const kv = makeSqliteKv(sql);
    const config = makeKvConfig(kv);

    return yield* createExecutor({
      ...config,
      plugins: [
        openApiPlugin({
          operationStore: makeKvOperationStore(kv, "openapi"),
        }),
        mcpPlugin({
          bindingStore: makeKvBindingStore(kv, "mcp"),
        }),
        keychainPlugin(),
        fileSecretsPlugin(),
        onepasswordPlugin({
          kv: scopeKv(kv, "onepassword"),
        }),
      ] as const,
    });
  }),
).pipe(
  Layer.provide(SqliteClient.layer({ filename: DB_PATH })),
);

// ---------------------------------------------------------------------------
// ManagedRuntime — keeps the SQLite scope alive for the process lifetime
// ---------------------------------------------------------------------------

const runtime = ManagedRuntime.make(ExecutorLayer);

/**
 * Get the shared executor instance. The ManagedRuntime keeps the SQLite
 * connection (and everything else) alive until the process exits.
 */
export const getExecutor = (): Promise<ServerExecutor> =>
  runtime.runPromise(ExecutorService);

/**
 * Provide `ExecutorService` to an Effect layer using the shared runtime.
 * Used by the API handler.
 */
export const ExecutorServiceLayer = Layer.effect(
  ExecutorService,
  Effect.promise(() => getExecutor()),
);
