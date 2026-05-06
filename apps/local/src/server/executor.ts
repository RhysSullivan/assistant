import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Context, Data, Effect, Layer, ManagedRuntime } from "effect";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import embeddedMigrations from "./embedded-migrations.gen";
import {
  importLegacySecrets,
  moveAsidePreScopeDb,
  readLegacySecrets,
  type LegacySecret,
} from "./db-upgrade";
import { migrateLegacyConnections } from "./migrate-connections";

import {
  Scope,
  ScopeId,
  type AnyPlugin,
  collectSchemas,
  createExecutor,
} from "@executor-js/sdk";
import {
  makeSqliteAdapter,
  makeSqliteBlobStore,
} from "@executor-js/storage-file";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { loadPluginsFromJsonc, makeFileConfigSink } from "@executor-js/config";
import * as executorSchema from "./executor-schema";

import { syncFromConfig, resolveConfigPath } from "./config-sync";
import executorConfig from "../../executor.config";

// In dev mode the drizzle folder sits next to the source tree. In a compiled
// binary the files are inlined via the build-time gen module below, and we
// extract them to a tmpdir at boot so drizzle's `migrate()` — which only
// accepts a folder path — can read them.
const resolveMigrationsFolder = (): string => {
  if (!embeddedMigrations) {
    return join(import.meta.dirname, "../../drizzle");
  }
  const dir = fs.mkdtempSync(join(tmpdir(), "executor-migrations-"));
  for (const [rel, content] of Object.entries(embeddedMigrations)) {
    const target = join(dir, rel);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
};

const MIGRATIONS_FOLDER = resolveMigrationsFolder();

interface ResolvedDb {
  readonly path: string;
  readonly legacySecrets: readonly LegacySecret[];
}

const resolveDbPath = (): ResolvedDb => {
  const dataDir = process.env.EXECUTOR_DATA_DIR ?? join(homedir(), ".executor");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = `${dataDir}/data.db`;
  // DBs written by pre-scope-refactor versions of the CLI have a schema
  // the current drizzle migration can't be applied on top of. Before we
  // move it aside, pull the `secret` routing rows so non-enumerating
  // providers (keychain) stay reachable after the fresh DB is created.
  const legacySecrets = readLegacySecrets(dbPath);
  const backup = moveAsidePreScopeDb(dbPath);
  if (backup) {
    console.warn(
      `[executor] Pre-scope database detected; moved to ${backup}. ` +
        `Sources and tool catalogs will need to be re-added` +
        (legacySecrets.length > 0
          ? ` (${legacySecrets.length} secret routing row(s) preserved).`
          : "."),
    );
  }
  return { path: dbPath, legacySecrets };
};

// Hash suffix disambiguates same-basename folders so two projects with
// identical directory names can't collide on the same scope id.
const makeScopeId = (cwd: string): string => {
  const folder = basename(cwd) || cwd;
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `${folder}-${hash}`;
};

// Plugins reach the host through two doors that compose:
//   - `executor.config.ts`'s static tuple (typed at TS compile time)
//   - `executor.jsonc#plugins` (loaded via jiti at boot)
// We concatenate the two and widen the result to `readonly AnyPlugin[]`.
// The frontend's typed atom client still resolves correctly because
// each plugin imports its own group from `${pkg}/shared`.
type LocalPlugins = readonly AnyPlugin[];

interface LocalExecutorBundle {
  readonly executor: Effect.Success<ReturnType<typeof createExecutor<LocalPlugins>>>;
  readonly plugins: LocalPlugins;
}

class LocalExecutorTag extends Context.Service<LocalExecutorTag, LocalExecutorBundle>()(
  "@executor-js/local/Executor",
) {}

export type LocalExecutor = LocalExecutorBundle["executor"];

class LocalExecutorDisposeError extends Data.TaggedError(
  "LocalExecutorDisposeError",
)<{
  readonly operation: "createHandle" | "disposeExecutor" | "disposeRuntime";
  readonly cause: unknown;
}> {}

const ignorePromiseFailure = (
  operation: LocalExecutorDisposeError["operation"],
  try_: () => Promise<unknown>,
) =>
  Effect.runPromise(
    Effect.ignore(
      Effect.tryPromise({
        try: try_,
        catch: (cause) => new LocalExecutorDisposeError({ operation, cause }),
      }),
    ),
  );

const handleOrNull = (promise: ReturnType<typeof createExecutorHandle>) =>
  Effect.runPromise(
    Effect.tryPromise({
      try: () => promise,
      catch: (cause) =>
        new LocalExecutorDisposeError({ operation: "createHandle", cause }),
    }).pipe(
      Effect.catch(() =>
        Effect.succeed<Awaited<ReturnType<typeof createExecutorHandle>> | null>(
          null,
        ),
      ),
    ),
  );

const createLocalExecutorLayer = () => {
  const { path: dbPath, legacySecrets } = resolveDbPath();

  return Layer.effect(LocalExecutorTag)(Effect.gen(function* () {
      const sqlite = yield* Effect.acquireRelease(
        Effect.sync(() => new Database(dbPath)),
        (conn) => Effect.sync(() => conn.close()),
      );
      sqlite.exec("PRAGMA journal_mode = WAL");

      const db = drizzle(sqlite, { schema: executorSchema });
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const cwd = process.env.EXECUTOR_SCOPE_DIR || process.cwd();
      const scopeId = makeScopeId(cwd);
      // Reinstate pre-scope secret routing rows once migrations have
      // created the new `secret` table. INSERT OR IGNORE makes this
      // safe across reboots and on fresh installs (no-op when there's
      // nothing to import).
      if (legacySecrets.length > 0) {
        importLegacySecrets(sqlite, scopeId, legacySecrets);
      }
      // Upgrade pre-connection openapi/mcp/google-discovery rows onto the
      // new Connection pointer shape. Idempotent + no-op when there's
      // nothing to migrate.
      yield* Effect.promise(() => migrateLegacyConnections(sqlite));
      const configPath = resolveConfigPath(cwd);
      const configFile = makeFileConfigSink({
        path: configPath,
        fsLayer: NodeFileSystem.layer,
      });

      const staticPlugins = executorConfig.plugins({ configFile });
      const dynamicPlugins =
        (yield* Effect.promise(() =>
          loadPluginsFromJsonc({ path: configPath, deps: { configFile } }),
        )) ?? [];
      // Static config wins on conflict — mirrors @executor-js/vite-plugin's
      // ordering. Without this, a package listed in both surfaces would
      // boot twice (double routes, double in-memory storage).
      const staticPackageNames = new Set(
        staticPlugins
          .map((p) => p.packageName)
          .filter((n): n is string => !!n),
      );
      const dedupedDynamic = dynamicPlugins.filter((p) => {
        if (p.packageName && staticPackageNames.has(p.packageName)) {
          console.warn(
            `[executor] plugin "${p.packageName}" appears in both ` +
              `executor.config.ts and executor.jsonc#plugins. The static ` +
              `entry wins; the jsonc entry is ignored.`,
          );
          return false;
        }
        return true;
      });
      const plugins: LocalPlugins = [...staticPlugins, ...dedupedDynamic];
      const schema = collectSchemas(plugins);
      const adapter = makeSqliteAdapter({ db, schema });
      const blobs = makeSqliteBlobStore({ db });

      const scope = new Scope({
        id: ScopeId.make(scopeId),
        name: cwd,
        createdAt: new Date(),
      });

      const executor = yield* createExecutor({
        scopes: [scope],
        adapter,
        blobs,
        plugins,
        onElicitation: "accept-all",
      });

      // Sync sources from executor.jsonc (idempotent — plugins upsert).
      // Runs after plugins are wired so sources added here round-trip
      // back through configFile — harmless because the file already
      // contains them.
      yield* syncFromConfig(executor, configPath);

      return { executor, plugins };
    }),
  );
};

export const createExecutorHandle = async () => {
  const layer = createLocalExecutorLayer();
  const runtime = ManagedRuntime.make(layer);
  const bundle = await runtime.runPromise(LocalExecutorTag.asEffect());

  return {
    executor: bundle.executor,
    plugins: bundle.plugins,
    dispose: async () => {
      await Effect.runPromise(Effect.ignore(bundle.executor.close()));
      await ignorePromiseFailure("disposeRuntime", () => runtime.dispose());
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
export const getExecutorBundle = () => loadSharedHandle();

export const disposeExecutor = async (): Promise<void> => {
  const currentHandlePromise = sharedHandlePromise;
  sharedHandlePromise = null;

  const handle = currentHandlePromise
    ? await handleOrNull(currentHandlePromise)
    : null;
  if (handle) {
    await ignorePromiseFailure("disposeExecutor", () => handle.dispose());
  }
};

export const reloadExecutor = () => {
  disposeExecutor();
  return getExecutor();
};
