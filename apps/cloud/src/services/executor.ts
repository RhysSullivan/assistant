// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, from Postgres
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { createExecutor, ScopeId, Scope } from "@executor/sdk";
import { makePostgresStores } from "@executor/storage-postgres";
import { openApiPlugin } from "@executor/plugin-openapi";
import { mcpPlugin } from "@executor/plugin-mcp";
import { googleDiscoveryPlugin } from "@executor/plugin-google-discovery";
import { graphqlPlugin } from "@executor/plugin-graphql";
import { DbService } from "./db";

export const createOrgExecutor = (
  organizationId: string,
  organizationName: string,
  encryptionKey: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbService;

    const scope = new Scope({
      id: ScopeId.make(organizationId),
      name: organizationName,
      createdAt: new Date(),
    });

    const stores = makePostgresStores(db);

    return yield* createExecutor({
      scope,
      stores,
      encryptionKey,
      plugins: [
        openApiPlugin(),
        mcpPlugin(),
        googleDiscoveryPlugin(),
        graphqlPlugin(),
      ] as const,
    });
  });
