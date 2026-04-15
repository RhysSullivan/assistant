import { Effect, Layer, ManagedRuntime, Context } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as SqlClient from "@effect/sql/SqlClient";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import {
  Scope,
  ScopeId,
  collectSchemas,
  createExecutor,
  type BlobStore,
} from "@executor/sdk";
import { makeSqliteAdapter } from "@executor/storage-file";

import { openApiPlugin } from "@executor/plugin-openapi";
import { mcpPlugin } from "@executor/plugin-mcp";
import { googleDiscoveryPlugin } from "@executor/plugin-google-discovery";
import { graphqlPlugin } from "@executor/plugin-graphql";
import { keychainPlugin } from "@executor/plugin-keychain";
import { fileSecretsPlugin } from "@executor/plugin-file-secrets";
import { onepasswordPlugin } from "@executor/plugin-onepassword";

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

const resolveDbPath = (): string => {
  const dataDir = process.env.EXECUTOR_DATA_DIR ?? join(homedir(), ".executor");
  fs.mkdirSync(dataDir, { recursive: true });
  return `${dataDir}/data.db`;
};

// ---------------------------------------------------------------------------
// makeSqliteBlobStore — BlobStore backed by a `blob` table in the same
// SQLite file the adapter uses. Keeps onepassword config (and any
// future plugin blobs) persistent across dev-server restarts without
// needing a second store. Inline here for now; could move to
// @executor/storage-file if another host needs it.
// ---------------------------------------------------------------------------

const makeSqliteBlobStore = (
  sql: SqlClient.SqlClient,
): Effect.Effect<BlobStore, Error> =>
  Effect.gen(function* () {
    yield* sql
      .unsafe(
        `CREATE TABLE IF NOT EXISTS "blob" (
          "namespace" TEXT NOT NULL,
          "key" TEXT NOT NULL,
          "value" TEXT NOT NULL,
          PRIMARY KEY ("namespace", "key")
        )`,
      )
      .pipe(
        Effect.mapError(
          (e) => new Error(`[apps/local] blob table DDL failed: ${String(e)}`),
        ),
      );

    const toErr = <A>(eff: Effect.Effect<A, unknown>) =>
      eff.pipe(
        Effect.mapError((e) =>
          e instanceof Error ? e : new Error(String(e)),
        ),
      );

    return {
      get: (namespace, key) =>
        toErr(
          sql<{ value: string }>`
            SELECT "value" FROM "blob"
            WHERE "namespace" = ${namespace} AND "key" = ${key}
            LIMIT 1
          `.pipe(Effect.map((rows) => rows[0]?.value ?? null)),
        ),
      put: (namespace, key, value) =>
        toErr(
          sql`
            INSERT INTO "blob" ("namespace", "key", "value")
            VALUES (${namespace}, ${key}, ${value})
            ON CONFLICT ("namespace", "key")
            DO UPDATE SET "value" = excluded."value"
          `.pipe(Effect.asVoid),
        ),
      delete: (namespace, key) =>
        toErr(
          sql`
            DELETE FROM "blob"
            WHERE "namespace" = ${namespace} AND "key" = ${key}
          `.pipe(Effect.asVoid),
        ),
      has: (namespace, key) =>
        toErr(
          sql<{ one: number }>`
            SELECT 1 AS "one" FROM "blob"
            WHERE "namespace" = ${namespace} AND "key" = ${key}
            LIMIT 1
          `.pipe(Effect.map((rows) => rows.length > 0)),
        ),
    };
  });

// Derive a URL-safe scope id from a folder path. Format:
// `${basename(cwd)}-${shortSha256}` — same as the pre-rewrite code. The
// hash suffix makes collisions between folders with the same basename
// structurally impossible.
const makeScopeId = (cwd: string): string => {
  const folder = basename(cwd) || cwd;
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `${folder}-${hash}`;
};

// ---------------------------------------------------------------------------
// Plugin list — one place, used for both the layer and type inference.
// The plugins themselves take no configuration at construction time in
// the new SDK shape; storage is injected via the executor's
// `{ adapter, blobs }` seam instead of per-plugin KV options.
// ---------------------------------------------------------------------------

const createLocalPlugins = () =>
  [
    openApiPlugin(),
    mcpPlugin({ dangerouslyAllowStdioMCP: true }),
    googleDiscoveryPlugin(),
    graphqlPlugin(),
    keychainPlugin(),
    fileSecretsPlugin(),
    onepasswordPlugin(),
  ] as const;

type LocalPlugins = ReturnType<typeof createLocalPlugins>;

class LocalExecutorTag extends Context.Tag("@executor/local/Executor")<
  LocalExecutorTag,
  Effect.Effect.Success<ReturnType<typeof createExecutor<LocalPlugins>>>
>() {}

export type LocalExecutor = Context.Tag.Service<typeof LocalExecutorTag>;

// ---------------------------------------------------------------------------
// Layer — SQLite-backed, keeps connection alive via ManagedRuntime
// ---------------------------------------------------------------------------

const createLocalExecutorLayer = () => {
  const dbPath = resolveDbPath();

  return Layer.effect(
    LocalExecutorTag,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const plugins = createLocalPlugins();
      const schema = collectSchemas(plugins);
      const adapter = yield* makeSqliteAdapter({ sql, schema });
      const blobs = yield* makeSqliteBlobStore(sql);

      const cwd = process.env.EXECUTOR_SCOPE_DIR || process.cwd();
      const scope = new Scope({
        id: ScopeId.make(makeScopeId(cwd)),
        name: cwd,
        createdAt: new Date(),
      });

      return yield* createExecutor({
        scope,
        adapter,
        blobs,
        plugins,
      });
    }),
  ).pipe(Layer.provide(SqliteClient.layer({ filename: dbPath })));
};

// ---------------------------------------------------------------------------
// Handle — keeps runtime alive, returns fully typed executor
// ---------------------------------------------------------------------------

export const createExecutorHandle = async () => {
  const layer = createLocalExecutorLayer();
  const runtime = ManagedRuntime.make(layer);
  const executor = await runtime.runPromise(LocalExecutorTag);

  return {
    executor,
    dispose: async () => {
      await Effect.runPromise(executor.close()).catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
    },
  };
};

export type ExecutorHandle = Awaited<ReturnType<typeof createExecutorHandle>>;

let sharedHandlePromise: ReturnType<typeof createExecutorHandle> | null = null;

const loadSharedHandle = () => {
  if (!sharedHandlePromise) {
    sharedHandlePromise = createExecutorHandle();
  }
  return sharedHandlePromise;
};

export const getExecutor = () => loadSharedHandle().then((handle) => handle.executor);

export const disposeExecutor = async (): Promise<void> => {
  const currentHandlePromise = sharedHandlePromise;
  sharedHandlePromise = null;

  const handle = await currentHandlePromise?.catch(() => null);
  await handle?.dispose().catch(() => undefined);
};

export const reloadExecutor = () => {
  disposeExecutor();
  return getExecutor();
};
