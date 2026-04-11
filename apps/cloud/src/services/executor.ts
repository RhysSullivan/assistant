// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, from Postgres
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { ScopeId, createExecutor, type Scope } from "@executor/sdk";
import {
  composeExecutorSchema,
  executorCoreSchema,
  type ExecutorDBSchema,
  type ExecutorModelSchema,
} from "@executor/storage";
import { makePostgresStorage } from "@executor/storage-postgres";
import { openApiPlugin } from "@executor/plugin-openapi";
import { mcpPlugin } from "@executor/plugin-mcp";
import { googleDiscoveryPlugin } from "@executor/plugin-google-discovery";
import { graphqlPlugin } from "@executor/plugin-graphql";
import { DbService } from "./db";

// ---------------------------------------------------------------------------
// Cloud schema override
//
// The production cloud Postgres DB uses `organization_id` as the scope
// column on every table (inherited from the pre-adapter Drizzle schema).
// The new `@executor/storage` contract uses `scopeId` as the logical
// field and defaults `columnName` to `scope_id`. We remap every model's
// `scopeId` field to `organization_id` so the new adapter reads and
// writes the existing tables in place.
// ---------------------------------------------------------------------------

const remapScopeIdToOrganizationId = (schema: ExecutorDBSchema): ExecutorDBSchema => {
  const remapped: Record<string, ExecutorModelSchema> = {};
  for (const [modelName, model] of Object.entries(schema)) {
    const fields = { ...model.fields };
    if (fields.scopeId) {
      fields.scopeId = { ...fields.scopeId, columnName: "organization_id" };
    }
    remapped[modelName] = { ...model, fields };
  }
  return remapped;
};

const cloudSchema = remapScopeIdToOrganizationId(executorCoreSchema);

// ---------------------------------------------------------------------------
// Create a fresh executor for an organization (stateless, per-request)
// ---------------------------------------------------------------------------

export const createOrgExecutor = (
  organizationId: string,
  organizationName: string,
  encryptionKey: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbService;

    const plugins = [
      openApiPlugin(),
      mcpPlugin(),
      googleDiscoveryPlugin(),
      graphqlPlugin(),
    ] as const;

    const schema = composeExecutorSchema({ core: cloudSchema, plugins });

    const storage = yield* makePostgresStorage(db, {
      schema,
      // Migrations are applied out-of-band via drizzle-kit migrate.
      // Cloudflare Workers cannot read the filesystem at request time.
      migrate: false,
    });

    const scope: Scope = {
      id: ScopeId.make(organizationId),
      name: organizationName,
      createdAt: new Date(),
    };

    return yield* createExecutor({
      scope,
      storage,
      plugins,
      encryptionKey,
    });
  });
