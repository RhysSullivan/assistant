import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePGlite } from "drizzle-orm/pglite";
import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import {
  approvalsTable,
  authConnectionsTable,
  authMaterialsTable,
  oauthStatesTable,
  organizationMembershipsTable,
  organizationsTable,
  policiesTable,
  profileTable,
  sourceAuthBindingsTable,
  sourcesTable,
  storageInstancesTable,
  syncStatesTable,
  taskRunsTable,
  toolArtifactsTable,
  workspacesTable,
} from "./schema";

export type SqlBackend = "pglite" | "postgres";
type CreateSqlRuntimeOptions = {
  databaseUrl?: string;
  localDataDir: string;
  postgresApplicationName?: string;
};

const drizzleSchema = {
  profileTable,
  organizationsTable,
  organizationMembershipsTable,
  workspacesTable,
  sourcesTable,
  toolArtifactsTable,
  authConnectionsTable,
  sourceAuthBindingsTable,
  authMaterialsTable,
  oauthStatesTable,
  policiesTable,
  approvalsTable,
  taskRunsTable,
  storageInstancesTable,
  syncStatesTable,
};

const createPGliteDb = (client: PGlite) => drizzlePGlite(client, { schema: drizzleSchema });
const createPostgresDb = (client: postgres.Sql) => drizzlePostgres(client, { schema: drizzleSchema });

type PGliteDb = ReturnType<typeof createPGliteDb>;
type PostgresDb = ReturnType<typeof createPostgresDb>;

export type DrizzleDb = PGliteDb | PostgresDb;
export type DrizzleTables = typeof drizzleSchema;

type SqlRuntime = {
  backend: SqlBackend;
  db: DrizzleDb;
  close: () => Promise<void>;
};

const createPGliteRuntime = async (localDataDir: string): Promise<SqlRuntime> => {
  const resolvedDataDir = path.resolve(localDataDir);
  await mkdir(resolvedDataDir, { recursive: true });

  const client = new PGlite(resolvedDataDir);
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
    ...(applicationName ? { connection: { application_name: applicationName } } : {}),
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

const resolveDrizzleMigrationsFolder = (): string => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(moduleDir, "..");
  const cwd = process.cwd();
  const candidates = [
    path.resolve(packageRoot, "drizzle"),
    path.resolve(cwd, "packages/persistence-sql/drizzle"),
    path.resolve(cwd, "../packages/persistence-sql/drizzle"),
    path.resolve(cwd, "../../packages/persistence-sql/drizzle"),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve drizzle migrations folder");
};

export type DrizzleContext = {
  db: DrizzleDb;
  tables: DrizzleTables;
};

export const createDrizzleContext = (db: DrizzleDb): DrizzleContext => ({
  db,
  tables: drizzleSchema,
});

export const createSqlRuntime = async (
  options: CreateSqlRuntimeOptions,
): Promise<SqlRuntime> => {
  const databaseUrl = options.databaseUrl?.trim();
  if (
    databaseUrl
    && (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))
  ) {
    return createPostgresRuntime(databaseUrl, options.postgresApplicationName?.trim());
  }

  return createPGliteRuntime(options.localDataDir);
};

export const runMigrations = async (runtime: SqlRuntime): Promise<void> => {
  const migrationsFolder = resolveDrizzleMigrationsFolder();

  if (runtime.backend === "pglite") {
    await migratePGlite(runtime.db as PGliteDb, { migrationsFolder });
    return;
  }

  await migratePostgres(runtime.db as PostgresDb, { migrationsFolder });
};
