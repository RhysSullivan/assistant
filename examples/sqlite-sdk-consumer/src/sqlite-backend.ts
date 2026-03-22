import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import { Database } from "bun:sqlite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import {
  createExecutorBackend,
  type ExecutorBackend,
  type ExecutorBackendServices,
  type ExecutorScopeConfigBackend,
  type ExecutorScopeStateBackend,
  type ExecutorSourceArtifactBackend,
} from "@executor/platform-sdk";
import type {
  AuthArtifact,
  AuthLease,
  Execution,
  ExecutionInteraction,
  ExecutionStep,
  LocalExecutorConfig,
  LocalInstallation,
  ProviderAuthGrant,
  ScopeOauthClient,
  ScopedSourceOauthClient,
  SecretMaterial,
  SecretRef,
  SourceAuthSession,
} from "@executor/platform-sdk/schema";
import {
  ScopeIdSchema,
  SecretMaterialIdSchema,
  SourceCatalogIdSchema,
  SourceCatalogRevisionIdSchema,
} from "@executor/platform-sdk/schema";
import {
  contentHash,
  snapshotFromSourceCatalogSyncResult,
} from "@executor/source-core";

export type CreateSqliteExecutorBackendOptions = {
  databasePath?: string;
  scopeName?: string;
  scopeRoot?: string | null;
  scopeId?: string;
  actorScopeId?: string;
};

type ScopeConfig = Awaited<ReturnType<ExecutorScopeConfigBackend["load"]>>;
type ScopeState = Awaited<ReturnType<ExecutorScopeStateBackend["load"]>>;
type SourceArtifact = ReturnType<ExecutorSourceArtifactBackend["build"]>;
type SourceArtifactBuildInput = Parameters<ExecutorSourceArtifactBackend["build"]>[0];

type SecretMaterialSummary = {
  id: string;
  providerId: string;
  name: string | null;
  purpose: string;
  createdAt: number;
  updatedAt: number;
};

const SQLITE_SECRET_PROVIDER_ID = "sqlite";

const installations = sqliteTable("installations", {
  key: text("key").primaryKey(),
  scopeId: text("scope_id").notNull(),
  actorScopeId: text("actor_scope_id").notNull(),
  resolutionScopeIdsJson: text("resolution_scope_ids_json").notNull(),
});

const scopeConfigs = sqliteTable("scope_configs", {
  key: text("key").primaryKey(),
  projectConfigJson: text("project_config_json").notNull(),
});

const scopeStates = sqliteTable("scope_states", {
  key: text("key").primaryKey(),
  stateJson: text("state_json").notNull(),
});

const sourceArtifacts = sqliteTable("source_artifacts", {
  sourceId: text("source_id").primaryKey(),
  artifactJson: text("artifact_json").notNull(),
});

const authArtifacts = sqliteTable("auth_artifacts", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  sourceId: text("source_id").notNull(),
  actorScopeId: text("actor_scope_id"),
  slot: text("slot").notNull(),
  json: text("json").notNull(),
});

const authLeases = sqliteTable("auth_leases", {
  authArtifactId: text("auth_artifact_id").primaryKey(),
  json: text("json").notNull(),
});

const sourceOauthClients = sqliteTable("source_oauth_clients", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  sourceId: text("source_id").notNull(),
  providerKey: text("provider_key").notNull(),
  json: text("json").notNull(),
});

const scopeOauthClients = sqliteTable("scope_oauth_clients", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  providerKey: text("provider_key").notNull(),
  json: text("json").notNull(),
});

const providerAuthGrants = sqliteTable("provider_auth_grants", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  actorScopeId: text("actor_scope_id"),
  providerKey: text("provider_key").notNull(),
  json: text("json").notNull(),
});

const sourceAuthSessions = sqliteTable("source_auth_sessions", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  sourceId: text("source_id").notNull(),
  actorScopeId: text("actor_scope_id"),
  state: text("state").notNull(),
  status: text("status").notNull(),
  credentialSlot: text("credential_slot"),
  json: text("json").notNull(),
});

const secretMaterials = sqliteTable("secret_materials", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  name: text("name"),
  purpose: text("purpose").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  json: text("json").notNull(),
});

const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),
  scopeId: text("scope_id").notNull(),
  json: text("json").notNull(),
});

const executionInteractions = sqliteTable("execution_interactions", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull(),
  status: text("status").notNull(),
  json: text("json").notNull(),
});

const executionSteps = sqliteTable("execution_steps", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull(),
  sequence: integer("sequence").notNull(),
  json: text("json").notNull(),
});

const makeHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

const sameActor = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => (left ?? null) === (right ?? null);

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

const createSourceArtifact = (input: SourceArtifactBuildInput): SourceArtifact => {
  const snapshot = snapshotFromSourceCatalogSyncResult(input.syncResult);
  const sourceConfigJson = JSON.stringify({
    kind: input.source.kind,
    endpoint: input.source.endpoint,
    namespace: input.source.namespace,
    name: input.source.name,
    enabled: input.source.enabled,
    binding: input.source.binding,
    auth: input.source.auth,
    importAuth: input.source.importAuth,
    importAuthPolicy: input.source.importAuthPolicy,
  });
  const importMetadataJson = JSON.stringify(snapshot.import);
  const catalogId = SourceCatalogIdSchema.make(`src_catalog_${makeHash(sourceConfigJson)}`);
  const revisionId = SourceCatalogRevisionIdSchema.make(
    `src_catalog_rev_${makeHash(sourceConfigJson)}`,
  );

  return {
    version: 4,
    sourceId: input.source.id,
    catalogId,
    generatedAt: Date.now(),
    revision: {
      id: revisionId,
      catalogId,
      revisionNumber: 1,
      sourceConfigJson,
      importMetadataJson,
      importMetadataHash: contentHash(importMetadataJson),
      snapshotHash: contentHash(JSON.stringify(snapshot)),
      createdAt: input.source.createdAt,
      updatedAt: input.source.updatedAt,
    },
    snapshot,
  };
};

const defaultScopeState = (): ScopeState => ({
  version: 1,
  sources: {},
  policies: {},
});

const createInstallation = (
  options: CreateSqliteExecutorBackendOptions,
): LocalInstallation => {
  const scopeId = ScopeIdSchema.make(options.scopeId ?? "scope_sqlite_example");
  const actorScopeId = ScopeIdSchema.make(
    options.actorScopeId ?? "account_sqlite_example",
  );

  return {
    scopeId,
    actorScopeId,
    resolutionScopeIds: [scopeId, actorScopeId],
  };
};

const openSqliteStore = (databasePath: string) => {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath, { create: true, strict: true });
  const db = drizzle(sqlite);

  sqlite.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        key TEXT PRIMARY KEY NOT NULL,
        scope_id TEXT NOT NULL,
        actor_scope_id TEXT NOT NULL,
        resolution_scope_ids_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scope_configs (
        key TEXT PRIMARY KEY NOT NULL,
        project_config_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scope_states (
        key TEXT PRIMARY KEY NOT NULL,
        state_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_artifacts (
        source_id TEXT PRIMARY KEY NOT NULL,
        artifact_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        scope_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        actor_scope_id TEXT,
        slot TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_leases (
        auth_artifact_id TEXT PRIMARY KEY NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_oauth_clients (
        id TEXT PRIMARY KEY NOT NULL,
        scope_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scope_oauth_clients (
        id TEXT PRIMARY KEY NOT NULL,
        scope_id TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_auth_grants (
        id TEXT PRIMARY KEY NOT NULL,
        scope_id TEXT NOT NULL,
        actor_scope_id TEXT,
        provider_key TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_auth_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        scope_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        actor_scope_id TEXT,
        state TEXT NOT NULL,
        status TEXT NOT NULL,
        credential_slot TEXT,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secret_materials (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        name TEXT,
        purpose TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY NOT NULL,
        scope_id TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_interactions (
        id TEXT PRIMARY KEY NOT NULL,
        execution_id TEXT NOT NULL,
        status TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_steps (
        id TEXT PRIMARY KEY NOT NULL,
        execution_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        json TEXT NOT NULL
      );
    `);
  return {
    sqlite,
    db,
    close: () => {
      sqlite.close();
    },
  };
};

type SqliteStore = ReturnType<typeof openSqliteStore>;

const createStorageDomains = (store: SqliteStore) => ({
  auth: {
    artifacts: {
    listByScopeId: (scopeId: AuthArtifact["scopeId"]) =>
      store.db.select().from(authArtifacts).where(eq(authArtifacts.scopeId, scopeId)).all()
        .map((row) => parseJson<AuthArtifact>(row.json)),
    listByScopeAndSourceId: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
    }) =>
      store.db.select().from(authArtifacts).where(
        and(
          eq(authArtifacts.scopeId, input.scopeId),
          eq(authArtifacts.sourceId, input.sourceId),
        ),
      ).all().map((row) => parseJson<AuthArtifact>(row.json)),
    getByScopeSourceAndActor: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
      actorScopeId: AuthArtifact["actorScopeId"];
      slot: AuthArtifact["slot"];
    }) =>
      store.db.select().from(authArtifacts).where(
        and(
          eq(authArtifacts.scopeId, input.scopeId),
          eq(authArtifacts.sourceId, input.sourceId),
          eq(authArtifacts.slot, input.slot),
        ),
      ).all().map((row) => parseJson<AuthArtifact>(row.json))
        .find((item) => sameActor(item.actorScopeId, input.actorScopeId)) ?? null,
    upsert: (artifact: AuthArtifact) =>
      store.db.insert(authArtifacts).values({
        id: artifact.id,
        scopeId: artifact.scopeId,
        sourceId: artifact.sourceId,
        actorScopeId: artifact.actorScopeId,
        slot: artifact.slot,
        json: JSON.stringify(artifact),
      }).onConflictDoUpdate({
        target: authArtifacts.id,
        set: {
          scopeId: artifact.scopeId,
          sourceId: artifact.sourceId,
          actorScopeId: artifact.actorScopeId,
          slot: artifact.slot,
          json: JSON.stringify(artifact),
        },
      }).run(),
    removeByScopeSourceAndActor: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
      actorScopeId: AuthArtifact["actorScopeId"];
      slot?: AuthArtifact["slot"];
    }) => {
      const rows = store.db.select().from(authArtifacts).where(
        and(
          eq(authArtifacts.scopeId, input.scopeId),
          eq(authArtifacts.sourceId, input.sourceId),
        ),
      ).all();
      const match = rows.find((row) => {
        const item = parseJson<AuthArtifact>(row.json);
        return sameActor(item.actorScopeId, input.actorScopeId)
          && (input.slot === undefined || item.slot === input.slot);
      });
      if (!match) return false;
      store.db.delete(authArtifacts).where(eq(authArtifacts.id, match.id)).run();
      return true;
    },
    removeByScopeAndSourceId: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
    }) => {
      const rows = store.db.select({ id: authArtifacts.id }).from(authArtifacts).where(
        and(
          eq(authArtifacts.scopeId, input.scopeId),
          eq(authArtifacts.sourceId, input.sourceId),
        ),
      ).all();
      store.db.delete(authArtifacts).where(
        and(
          eq(authArtifacts.scopeId, input.scopeId),
          eq(authArtifacts.sourceId, input.sourceId),
        ),
      ).run();
      return rows.length;
    },
  },
    leases: {
    listAll: () =>
      store.db.select().from(authLeases).all().map((row) => parseJson<AuthLease>(row.json)),
    getByAuthArtifactId: (authArtifactId: AuthLease["authArtifactId"]) => {
      const row = store.db.select().from(authLeases).where(
        eq(authLeases.authArtifactId, authArtifactId),
      ).get();
      return row ? parseJson<AuthLease>(row.json) : null;
    },
    upsert: (lease: AuthLease) =>
      store.db.insert(authLeases).values({
        authArtifactId: lease.authArtifactId,
        json: JSON.stringify(lease),
      }).onConflictDoUpdate({
        target: authLeases.authArtifactId,
        set: { json: JSON.stringify(lease) },
      }).run(),
    removeByAuthArtifactId: (authArtifactId: AuthLease["authArtifactId"]) => {
      const row = store.db.select({ id: authLeases.authArtifactId }).from(authLeases).where(
        eq(authLeases.authArtifactId, authArtifactId),
      ).get();
      if (!row) return false;
      store.db.delete(authLeases).where(eq(authLeases.authArtifactId, authArtifactId)).run();
      return true;
    },
  },
    sourceOauthClients: {
    getByScopeSourceAndProvider: (input: {
      scopeId: ScopedSourceOauthClient["scopeId"];
      sourceId: ScopedSourceOauthClient["sourceId"];
      providerKey: string;
    }) => {
      const row = store.db.select().from(sourceOauthClients).where(
        and(
          eq(sourceOauthClients.scopeId, input.scopeId),
          eq(sourceOauthClients.sourceId, input.sourceId),
          eq(sourceOauthClients.providerKey, input.providerKey),
        ),
      ).get();
      return row ? parseJson<ScopedSourceOauthClient>(row.json) : null;
    },
    upsert: (oauthClient: ScopedSourceOauthClient) =>
      store.db.insert(sourceOauthClients).values({
        id: oauthClient.id,
        scopeId: oauthClient.scopeId,
        sourceId: oauthClient.sourceId,
        providerKey: oauthClient.providerKey,
        json: JSON.stringify(oauthClient),
      }).onConflictDoUpdate({
        target: sourceOauthClients.id,
        set: {
          scopeId: oauthClient.scopeId,
          sourceId: oauthClient.sourceId,
          providerKey: oauthClient.providerKey,
          json: JSON.stringify(oauthClient),
        },
      }).run(),
    removeByScopeAndSourceId: (input: {
      scopeId: ScopedSourceOauthClient["scopeId"];
      sourceId: ScopedSourceOauthClient["sourceId"];
    }) => {
      const rows = store.db.select({ id: sourceOauthClients.id }).from(sourceOauthClients).where(
        and(
          eq(sourceOauthClients.scopeId, input.scopeId),
          eq(sourceOauthClients.sourceId, input.sourceId),
        ),
      ).all();
      store.db.delete(sourceOauthClients).where(
        and(
          eq(sourceOauthClients.scopeId, input.scopeId),
          eq(sourceOauthClients.sourceId, input.sourceId),
        ),
      ).run();
      return rows.length;
    },
  },
    scopeOauthClients: {
    listByScopeAndProvider: (input: {
      scopeId: ScopeOauthClient["scopeId"];
      providerKey: string;
    }) =>
      store.db.select().from(scopeOauthClients).where(
        and(
          eq(scopeOauthClients.scopeId, input.scopeId),
          eq(scopeOauthClients.providerKey, input.providerKey),
        ),
      ).all().map((row) => parseJson<ScopeOauthClient>(row.json)),
    getById: (id: ScopeOauthClient["id"]) => {
      const row = store.db.select().from(scopeOauthClients).where(eq(scopeOauthClients.id, id)).get();
      return row ? parseJson<ScopeOauthClient>(row.json) : null;
    },
    upsert: (oauthClient: ScopeOauthClient) =>
      store.db.insert(scopeOauthClients).values({
        id: oauthClient.id,
        scopeId: oauthClient.scopeId,
        providerKey: oauthClient.providerKey,
        json: JSON.stringify(oauthClient),
      }).onConflictDoUpdate({
        target: scopeOauthClients.id,
        set: {
          scopeId: oauthClient.scopeId,
          providerKey: oauthClient.providerKey,
          json: JSON.stringify(oauthClient),
        },
      }).run(),
    removeById: (id: ScopeOauthClient["id"]) => {
      const row = store.db.select({ id: scopeOauthClients.id }).from(scopeOauthClients).where(
        eq(scopeOauthClients.id, id),
      ).get();
      if (!row) return false;
      store.db.delete(scopeOauthClients).where(eq(scopeOauthClients.id, id)).run();
      return true;
    },
  },
    providerGrants: {
    listByScopeId: (scopeId: ProviderAuthGrant["scopeId"]) =>
      store.db.select().from(providerAuthGrants).where(
        eq(providerAuthGrants.scopeId, scopeId),
      ).all().map((row) => parseJson<ProviderAuthGrant>(row.json)),
    listByScopeActorAndProvider: (input: {
      scopeId: ProviderAuthGrant["scopeId"];
      actorScopeId: ProviderAuthGrant["actorScopeId"];
      providerKey: string;
    }) =>
      store.db.select().from(providerAuthGrants).where(
        and(
          eq(providerAuthGrants.scopeId, input.scopeId),
          eq(providerAuthGrants.providerKey, input.providerKey),
        ),
      ).all().map((row) => parseJson<ProviderAuthGrant>(row.json))
        .filter((item) => sameActor(item.actorScopeId, input.actorScopeId)),
    getById: (id: ProviderAuthGrant["id"]) => {
      const row = store.db.select().from(providerAuthGrants).where(
        eq(providerAuthGrants.id, id),
      ).get();
      return row ? parseJson<ProviderAuthGrant>(row.json) : null;
    },
    upsert: (grant: ProviderAuthGrant) =>
      store.db.insert(providerAuthGrants).values({
        id: grant.id,
        scopeId: grant.scopeId,
        actorScopeId: grant.actorScopeId,
        providerKey: grant.providerKey,
        json: JSON.stringify(grant),
      }).onConflictDoUpdate({
        target: providerAuthGrants.id,
        set: {
          scopeId: grant.scopeId,
          actorScopeId: grant.actorScopeId,
          providerKey: grant.providerKey,
          json: JSON.stringify(grant),
        },
      }).run(),
    removeById: (id: ProviderAuthGrant["id"]) => {
      const row = store.db.select({ id: providerAuthGrants.id }).from(providerAuthGrants).where(
        eq(providerAuthGrants.id, id),
      ).get();
      if (!row) return false;
      store.db.delete(providerAuthGrants).where(eq(providerAuthGrants.id, id)).run();
      return true;
    },
  },
    sourceSessions: {
    listAll: () =>
      store.db.select().from(sourceAuthSessions).all().map((row) => parseJson<SourceAuthSession>(row.json)),
    listByScopeId: (scopeId: SourceAuthSession["scopeId"]) =>
      store.db.select().from(sourceAuthSessions).where(
        eq(sourceAuthSessions.scopeId, scopeId),
      ).all().map((row) => parseJson<SourceAuthSession>(row.json)),
    getById: (id: SourceAuthSession["id"]) => {
      const row = store.db.select().from(sourceAuthSessions).where(eq(sourceAuthSessions.id, id)).get();
      return row ? parseJson<SourceAuthSession>(row.json) : null;
    },
    getByState: (state: SourceAuthSession["state"]) => {
      const row = store.db.select().from(sourceAuthSessions).where(
        eq(sourceAuthSessions.state, state),
      ).get();
      return row ? parseJson<SourceAuthSession>(row.json) : null;
    },
    getPendingByScopeSourceAndActor: (input: {
      scopeId: SourceAuthSession["scopeId"];
      sourceId: SourceAuthSession["sourceId"];
      actorScopeId: SourceAuthSession["actorScopeId"];
      credentialSlot?: SourceAuthSession["credentialSlot"];
    }) =>
      store.db.select().from(sourceAuthSessions).where(
        and(
          eq(sourceAuthSessions.scopeId, input.scopeId),
          eq(sourceAuthSessions.sourceId, input.sourceId),
          eq(sourceAuthSessions.status, "pending"),
        ),
      ).all().map((row) => parseJson<SourceAuthSession>(row.json))
        .find((item) =>
          sameActor(item.actorScopeId, input.actorScopeId)
          && (input.credentialSlot === undefined || item.credentialSlot === input.credentialSlot)
        ) ?? null,
    insert: (session: SourceAuthSession) =>
      store.db.insert(sourceAuthSessions).values({
        id: session.id,
        scopeId: session.scopeId,
        sourceId: session.sourceId,
        actorScopeId: session.actorScopeId,
        state: session.state,
        status: session.status,
        credentialSlot: session.credentialSlot,
        json: JSON.stringify(session),
      }).run(),
    update: (
      id: SourceAuthSession["id"],
      patch: Partial<Omit<SourceAuthSession, "id" | "scopeId" | "sourceId" | "createdAt">>,
    ) => {
      const current = store.db.select().from(sourceAuthSessions).where(eq(sourceAuthSessions.id, id)).get();
      if (!current) return null;
      const next = { ...parseJson<SourceAuthSession>(current.json), ...patch };
      store.db.update(sourceAuthSessions).set({
        state: next.state,
        status: next.status,
        credentialSlot: next.credentialSlot,
        actorScopeId: next.actorScopeId,
        json: JSON.stringify(next),
      }).where(eq(sourceAuthSessions.id, id)).run();
      return next;
    },
    upsert: (session: SourceAuthSession) =>
      store.db.insert(sourceAuthSessions).values({
        id: session.id,
        scopeId: session.scopeId,
        sourceId: session.sourceId,
        actorScopeId: session.actorScopeId,
        state: session.state,
        status: session.status,
        credentialSlot: session.credentialSlot,
        json: JSON.stringify(session),
      }).onConflictDoUpdate({
        target: sourceAuthSessions.id,
        set: {
          scopeId: session.scopeId,
          sourceId: session.sourceId,
          actorScopeId: session.actorScopeId,
          state: session.state,
          status: session.status,
          credentialSlot: session.credentialSlot,
          json: JSON.stringify(session),
        },
      }).run(),
    removeByScopeAndSourceId: (
      scopeId: SourceAuthSession["scopeId"],
      sourceId: SourceAuthSession["sourceId"],
    ) => {
      const rows = store.db.select({ id: sourceAuthSessions.id }).from(sourceAuthSessions).where(
        and(
          eq(sourceAuthSessions.scopeId, scopeId),
          eq(sourceAuthSessions.sourceId, sourceId),
        ),
      ).all();
      store.db.delete(sourceAuthSessions).where(
        and(
          eq(sourceAuthSessions.scopeId, scopeId),
          eq(sourceAuthSessions.sourceId, sourceId),
        ),
      ).run();
      return rows.length > 0;
    },
  },
  },
  secrets: {
    getById: (id: SecretMaterial["id"]) => {
      const row = store.db.select().from(secretMaterials).where(eq(secretMaterials.id, id)).get();
      return row ? parseJson<SecretMaterial>(row.json) : null;
    },
    listAll: (): readonly SecretMaterialSummary[] =>
      store.db.select().from(secretMaterials).all().map((row) => ({
        id: row.id,
        providerId: row.providerId,
        name: row.name,
        purpose: row.purpose,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    upsert: (material: SecretMaterial) =>
      store.db.insert(secretMaterials).values({
        id: material.id,
        providerId: material.providerId,
        name: material.name,
        purpose: material.purpose,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
        json: JSON.stringify(material),
      }).onConflictDoUpdate({
        target: secretMaterials.id,
        set: {
          providerId: material.providerId,
          name: material.name,
          purpose: material.purpose,
          createdAt: material.createdAt,
          updatedAt: material.updatedAt,
          json: JSON.stringify(material),
        },
      }).run(),
    updateById: (
      id: SecretMaterial["id"],
      update: { name?: string | null; value?: string },
    ) => {
      const row = store.db.select().from(secretMaterials).where(eq(secretMaterials.id, id)).get();
      if (!row) return null;
      const current = parseJson<SecretMaterial>(row.json);
      const next = {
        ...current,
        name: update.name === undefined ? current.name : update.name,
        value: update.value === undefined ? current.value : update.value,
        updatedAt: Date.now(),
      };
      store.db.update(secretMaterials).set({
        providerId: next.providerId,
        name: next.name,
        purpose: next.purpose,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
        json: JSON.stringify(next),
      }).where(eq(secretMaterials.id, id)).run();
      return {
        id: next.id,
        providerId: next.providerId,
        name: next.name,
        purpose: next.purpose,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
      } satisfies SecretMaterialSummary;
    },
    removeById: (id: SecretMaterial["id"]) => {
      const row = store.db.select({ id: secretMaterials.id }).from(secretMaterials).where(
        eq(secretMaterials.id, id),
      ).get();
      if (!row) return false;
      store.db.delete(secretMaterials).where(eq(secretMaterials.id, id)).run();
      return true;
    },
  },
  executions: {
    runs: {
    getById: (executionId: Execution["id"]) => {
      const row = store.db.select().from(executions).where(eq(executions.id, executionId)).get();
      return row ? parseJson<Execution>(row.json) : null;
    },
    getByScopeAndId: (
      scopeId: Execution["scopeId"],
      executionId: Execution["id"],
    ) => {
      const row = store.db.select().from(executions).where(
        and(eq(executions.scopeId, scopeId), eq(executions.id, executionId)),
      ).get();
      return row ? parseJson<Execution>(row.json) : null;
    },
    insert: (execution: Execution) =>
      store.db.insert(executions).values({
        id: execution.id,
        scopeId: execution.scopeId,
        json: JSON.stringify(execution),
      }).run(),
    update: (
      executionId: Execution["id"],
      patch: Partial<Omit<Execution, "id" | "scopeId" | "createdByScopeId" | "createdAt">>,
    ) => {
      const row = store.db.select().from(executions).where(eq(executions.id, executionId)).get();
      if (!row) return null;
      const next = { ...parseJson<Execution>(row.json), ...patch };
      store.db.update(executions).set({
        scopeId: next.scopeId,
        json: JSON.stringify(next),
      }).where(eq(executions.id, executionId)).run();
      return next;
    },
  },
    interactions: {
    getById: (interactionId: ExecutionInteraction["id"]) => {
      const row = store.db.select().from(executionInteractions).where(
        eq(executionInteractions.id, interactionId),
      ).get();
      return row ? parseJson<ExecutionInteraction>(row.json) : null;
    },
    listByExecutionId: (executionId: ExecutionInteraction["executionId"]) =>
      store.db.select().from(executionInteractions).where(
        eq(executionInteractions.executionId, executionId),
      ).all().map((row) => parseJson<ExecutionInteraction>(row.json)),
    getPendingByExecutionId: (executionId: ExecutionInteraction["executionId"]) => {
      const row = store.db.select().from(executionInteractions).where(
        and(
          eq(executionInteractions.executionId, executionId),
          eq(executionInteractions.status, "pending"),
        ),
      ).get();
      return row ? parseJson<ExecutionInteraction>(row.json) : null;
    },
    insert: (interaction: ExecutionInteraction) =>
      store.db.insert(executionInteractions).values({
        id: interaction.id,
        executionId: interaction.executionId,
        status: interaction.status,
        json: JSON.stringify(interaction),
      }).run(),
    update: (
      interactionId: ExecutionInteraction["id"],
      patch: Partial<Omit<ExecutionInteraction, "id" | "executionId" | "createdAt">>,
    ) => {
      const row = store.db.select().from(executionInteractions).where(
        eq(executionInteractions.id, interactionId),
      ).get();
      if (!row) return null;
      const next = { ...parseJson<ExecutionInteraction>(row.json), ...patch };
      store.db.update(executionInteractions).set({
        executionId: next.executionId,
        status: next.status,
        json: JSON.stringify(next),
      }).where(eq(executionInteractions.id, interactionId)).run();
      return next;
    },
  },
    steps: {
    getByExecutionAndSequence: (
      executionId: ExecutionStep["executionId"],
      sequence: ExecutionStep["sequence"],
    ) => {
      const row = store.db.select().from(executionSteps).where(
        and(
          eq(executionSteps.executionId, executionId),
          eq(executionSteps.sequence, sequence),
        ),
      ).get();
      return row ? parseJson<ExecutionStep>(row.json) : null;
    },
    listByExecutionId: (executionId: ExecutionStep["executionId"]) =>
      store.db.select().from(executionSteps).where(
        eq(executionSteps.executionId, executionId),
      ).orderBy(executionSteps.sequence).all().map((row) => parseJson<ExecutionStep>(row.json)),
    insert: (step: ExecutionStep) =>
      store.db.insert(executionSteps).values({
        id: step.id,
        executionId: step.executionId,
        sequence: step.sequence,
        json: JSON.stringify(step),
      }).run(),
    deleteByExecutionId: (executionId: ExecutionStep["executionId"]) => {
      store.db.delete(executionSteps).where(eq(executionSteps.executionId, executionId)).run();
    },
    updateByExecutionAndSequence: (
      executionId: ExecutionStep["executionId"],
      sequence: ExecutionStep["sequence"],
      patch: Partial<Omit<ExecutionStep, "id" | "executionId" | "sequence" | "createdAt">>,
    ) => {
      const row = store.db.select().from(executionSteps).where(
        and(
          eq(executionSteps.executionId, executionId),
          eq(executionSteps.sequence, sequence),
        ),
      ).get();
      if (!row) return null;
      const next = { ...parseJson<ExecutionStep>(row.json), ...patch };
      store.db.update(executionSteps).set({
        id: next.id,
        executionId: next.executionId,
        sequence: next.sequence,
        json: JSON.stringify(next),
      }).where(eq(executionSteps.id, row.id)).run();
      return next;
    },
  },
  },
});

export const createSqliteExecutorBackend = (
  options: CreateSqliteExecutorBackendOptions = {},
): ExecutorBackend => {
  const databasePath = options.databasePath && options.databasePath !== ":memory:"
    ? resolvePath(options.databasePath)
    : (options.databasePath ?? ":memory:");

  return createExecutorBackend({
    loadServices: () => {
      const store = openSqliteStore(databasePath);
      const { auth, secrets, executions } = createStorageDomains(store);

      return {
        scope: {
          scopeName: options.scopeName ?? "SQLite SDK Example",
          scopeRoot: options.scopeRoot ?? null,
          metadata: {
            kind: "sqlite",
            databasePath,
          },
        },
        storage: {
          installation: {
            load: () => {
              const row = store.db.select().from(installations).where(eq(installations.key, "active")).get();
              return row
                ? {
                    scopeId: row.scopeId as LocalInstallation["scopeId"],
                    actorScopeId: row.actorScopeId as LocalInstallation["actorScopeId"],
                    resolutionScopeIds: parseJson<LocalInstallation["resolutionScopeIds"]>(
                      row.resolutionScopeIdsJson,
                    ),
                  }
                : createInstallation(options);
            },
            getOrProvision: () => {
              const installation = (() => {
                const row = store.db.select().from(installations).where(eq(installations.key, "active")).get();
                return row
                  ? {
                      scopeId: row.scopeId as LocalInstallation["scopeId"],
                      actorScopeId: row.actorScopeId as LocalInstallation["actorScopeId"],
                      resolutionScopeIds: parseJson<LocalInstallation["resolutionScopeIds"]>(
                        row.resolutionScopeIdsJson,
                      ),
                    }
                  : createInstallation(options);
              })();
              store.db.insert(installations).values({
                key: "active",
                scopeId: installation.scopeId,
                actorScopeId: installation.actorScopeId,
                resolutionScopeIdsJson: JSON.stringify(installation.resolutionScopeIds),
              }).onConflictDoUpdate({
                target: installations.key,
                set: {
                  scopeId: installation.scopeId,
                  actorScopeId: installation.actorScopeId,
                  resolutionScopeIdsJson: JSON.stringify(installation.resolutionScopeIds),
                },
              }).run();
              return installation;
            },
          },
          scopeConfig: {
            load: () => {
              const row = store.db.select().from(scopeConfigs).where(eq(scopeConfigs.key, "project")).get();
              const projectConfig = row
                ? parseJson<LocalExecutorConfig>(row.projectConfigJson)
                : {};
              return {
                config: projectConfig,
                homeConfig: null,
                projectConfig,
              } satisfies ScopeConfig;
            },
            writeProject: (config) => {
              store.db.insert(scopeConfigs).values({
                key: "project",
                projectConfigJson: JSON.stringify(config),
              }).onConflictDoUpdate({
                target: scopeConfigs.key,
                set: { projectConfigJson: JSON.stringify(config) },
              }).run();
            },
            resolveRelativePath: ({ path, scopeRoot }) => resolvePath(scopeRoot, path),
          },
          scopeState: {
            load: () => {
              const row = store.db.select().from(scopeStates).where(eq(scopeStates.key, "active")).get();
              return row ? parseJson<ScopeState>(row.stateJson) : defaultScopeState();
            },
            write: (state) => {
              store.db.insert(scopeStates).values({
                key: "active",
                stateJson: JSON.stringify(state),
              }).onConflictDoUpdate({
                target: scopeStates.key,
                set: { stateJson: JSON.stringify(state) },
              }).run();
            },
          },
          sourceArtifacts: {
            build: createSourceArtifact,
            read: (sourceId) => {
              const row = store.db.select().from(sourceArtifacts).where(
                eq(sourceArtifacts.sourceId, sourceId),
              ).get();
              return row ? parseJson<SourceArtifact>(row.artifactJson) : null;
            },
            write: ({ sourceId, artifact }) => {
              store.db.insert(sourceArtifacts).values({
                sourceId,
                artifactJson: JSON.stringify(artifact),
              }).onConflictDoUpdate({
                target: sourceArtifacts.sourceId,
                set: { artifactJson: JSON.stringify(artifact) },
              }).run();
            },
            remove: (sourceId) => {
              store.db.delete(sourceArtifacts).where(eq(sourceArtifacts.sourceId, sourceId)).run();
            },
          },
          auth,
          secrets: {
            ...secrets,
            resolve: ({ ref }) => {
              const material = secrets.getById(
                ref.handle as SecretMaterial["id"],
              );
              if (!material || material.value === null) {
                throw new Error(`Missing secret material ${ref.handle}`);
              }
              return material.value;
            },
            store: ({ purpose, value, name, providerId }) => {
              const now = Date.now();
              const id = SecretMaterialIdSchema.make(`secret_${randomUUID()}`);
              const material: SecretMaterial = {
                id,
                providerId: providerId ?? SQLITE_SECRET_PROVIDER_ID,
                handle: id,
                name: name ?? null,
                purpose,
                value,
                createdAt: now,
                updatedAt: now,
              };
              secrets.upsert(material);
              return {
                providerId: material.providerId,
                handle: material.handle,
              } satisfies SecretRef;
            },
            delete: (ref) =>
              secrets.removeById(ref.handle as SecretMaterial["id"]),
            update: ({ ref, name, value }) => {
              const updated = secrets.updateById(
                ref.handle as SecretMaterial["id"],
                { name, value },
              );
              if (!updated) {
                throw new Error(`Missing secret material ${ref.handle}`);
              }
              return updated;
            },
          },
          executions,
          close: async () => {
            store.close();
          },
        },
        instanceConfig: {
          resolve: () => ({
            platform: "sqlite-sdk-example",
            secretProviders: [
              {
                id: SQLITE_SECRET_PROVIDER_ID,
                name: "SQLite",
                canStore: true,
              },
            ],
            defaultSecretStoreProvider: SQLITE_SECRET_PROVIDER_ID,
          }),
        },
      } satisfies ExecutorBackendServices;
    },
  });
};
