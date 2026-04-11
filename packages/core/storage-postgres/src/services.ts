// ---------------------------------------------------------------------------
// makePostgresServices — assemble all services from Postgres-backed stores.
//
// Migrations are NOT run here. Callers are responsible for running migrations
// externally before invoking this factory. For PGlite-based tests, use
// src/testing/pglite.ts which runs migrations automatically via drizzle-kit.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import {
  makeInMemorySourceRegistry,
  makeToolRegistry,
  makeSecretManager,
  makePolicyEngine,
  makePluginKvFactory,
  type Scope,
  type SecretProvider,
} from "@executor/storage";

import type { DrizzleDb } from "./db";
import {
  makePostgresToolStore,
  makePostgresSecretStore,
  makePostgresPolicyStore,
  makePostgresPluginKvStore,
} from "./stores";

export interface PostgresServicesOptions {
  readonly scope: Scope;
  readonly encryptionKey: string;
  readonly secretProviders?: readonly SecretProvider[];
}

export const makePostgresServices = (db: DrizzleDb, options: PostgresServicesOptions) =>
  Effect.gen(function* () {
    const toolStore = makePostgresToolStore(db);
    const secretStore = makePostgresSecretStore(db);
    const policyStore = makePostgresPolicyStore(db);
    const pluginKvStore = makePostgresPluginKvStore(db);

    return {
      tools: makeToolRegistry(toolStore, options.scope),
      sources: makeInMemorySourceRegistry(),
      secrets: makeSecretManager(secretStore, options.scope, {
        encryptionKey: options.encryptionKey,
        providers: options.secretProviders ?? [],
      }),
      policies: makePolicyEngine(policyStore, options.scope),
      pluginKv: makePluginKvFactory(pluginKvStore, options.scope),
    };
  });
