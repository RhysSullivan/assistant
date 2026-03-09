import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePGlite } from "drizzle-orm/pglite";
import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { drizzleSchema } from "./schema";

export type SqlBackend = "pglite" | "postgres";

export type CreateSqlRuntimeOptions = {
  databaseUrl?: string;
  localDataDir?: string;
  postgresApplicationName?: string;
  migrationsFolder?: string;
};

const createPGliteDb = (client: PGlite) =>
  drizzlePGlite({ client, schema: drizzleSchema });

const createPostgresDb = (client: postgres.Sql) =>
  drizzlePostgres({ client, schema: drizzleSchema });

export type PGliteDb = ReturnType<typeof createPGliteDb>;
export type PostgresDb = ReturnType<typeof createPostgresDb>;
export type DrizzleDb = PGliteDb | PostgresDb;

export type SqlRuntime = {
  backend: SqlBackend;
  db: DrizzleDb;
  close: () => Promise<void>;
};

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const isPostgresUrl = (value: string): boolean =>
  value.startsWith("postgres://") || value.startsWith("postgresql://");

/**
 * Remove a stale PGlite `postmaster.pid` lock file if present.
 *
 * PGlite writes this file on open and removes it on close. When a process
 * exits without calling `PGlite.close()` (e.g. the Vite dev server is
 * killed with SIGKILL, or the terminal is closed), the lock file is left
 * behind and prevents subsequent PGlite instances from opening the
 * database. PGlite uses a synthetic PID (e.g. `-42`) that is never a real
 * OS process, so we cannot use it to detect a live owner. Instead we rely
 * on the fact that in the local single-user context only one process
 * should ever own this database at a time.
 */
const cleanupStalePGliteLock = async (dataDir: string): Promise<void> => {
  const lockPath = path.join(dataDir, "postmaster.pid");
  if (!existsSync(lockPath)) {
    return;
  }

  // PGlite's synthetic PID is always negative (e.g. -42). A real Postgres
  // postmaster would write a positive PID. If we ever see a positive PID
  // we leave the file alone.
  try {
    const content = readFileSync(lockPath, "utf-8");
    const firstLine = content.split("\n")[0]?.trim();
    const pid = Number(firstLine);
    if (!Number.isNaN(pid) && pid > 0) {
      // Looks like a real Postgres PID — don't touch it.
      return;
    }
  } catch {
    // If we can't read the file, try to remove it anyway.
  }

  try {
    await unlink(lockPath);
  } catch {
    // Best-effort cleanup; PGlite will report the real error if this fails.
  }
};

const createPGliteRuntime = async (localDataDir: string): Promise<SqlRuntime> => {
  const normalized = trim(localDataDir) ?? ".executor-v3/control-plane-pgdata";

  let client: PGlite;
  if (normalized === ":memory:") {
    client = new PGlite();
  } else {
    const resolvedDataDir = path.resolve(normalized);
    if (!existsSync(resolvedDataDir)) {
      await mkdir(resolvedDataDir, { recursive: true });
    }
    await cleanupStalePGliteLock(resolvedDataDir);
    client = new PGlite(resolvedDataDir);
  }

  const db = createPGliteDb(client);

  return {
    backend: "pglite",
    db,
    close: async () => {
      await client.close();
    },
  };
};

const createPostgresRuntime = async (
  databaseUrl: string,
  applicationName: string | undefined,
): Promise<SqlRuntime> => {
  const client = postgres(databaseUrl, {
    prepare: false,
    max: 10,
    ...(applicationName
      ? { connection: { application_name: applicationName } }
      : {}),
  });
  const db = createPostgresDb(client);

  return {
    backend: "postgres",
    db,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
};

const resolveMigrationsFolder = (explicit: string | undefined): string => {
  const explicitTrimmed = trim(explicit);
  if (explicitTrimmed) {
    return path.resolve(explicitTrimmed);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(moduleDir, "../..");
  const cwd = process.cwd();
  const candidates = [
    path.resolve(packageRoot, "drizzle"),
    path.resolve(cwd, "packages/control-plane/drizzle"),
    path.resolve(cwd, "drizzle"),
  ];

  const hasModernMigrations = (candidate: string): boolean => {
    if (!existsSync(candidate)) {
      return false;
    }

    const entries = readdirSync(candidate, { withFileTypes: true });
    return entries.some(
      (entry) =>
        entry.isDirectory()
        && existsSync(path.join(candidate, entry.name, "migration.sql")),
    );
  };

  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, "meta", "_journal.json"))
      || hasModernMigrations(candidate)
    ) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to resolve Drizzle migrations folder for control-plane persistence",
  );
};

export const runMigrations = async (
  runtime: SqlRuntime,
  options?: { migrationsFolder?: string },
): Promise<void> => {
  const migrationsFolder = resolveMigrationsFolder(options?.migrationsFolder);

  if (runtime.backend === "pglite") {
    await migratePGlite(runtime.db as PGliteDb, { migrationsFolder });
    return;
  }

  await migratePostgres(runtime.db as PostgresDb, { migrationsFolder });
};

export const createSqlRuntime = async (
  options: CreateSqlRuntimeOptions,
): Promise<SqlRuntime> => {
  const databaseUrl = trim(options.databaseUrl);
  const runtime =
    databaseUrl && isPostgresUrl(databaseUrl)
      ? await createPostgresRuntime(
          databaseUrl,
          trim(options.postgresApplicationName),
        )
      : await createPGliteRuntime(
          options.localDataDir ?? ".executor-v3/control-plane-pgdata",
        );

  return runtime;
};
