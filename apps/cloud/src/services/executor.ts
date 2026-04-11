// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, from Postgres
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { createExecutor } from "@executor/sdk";
import { ScopeId, type Scope } from "@executor/storage";
import { makePostgresServices } from "@executor/storage-postgres";
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

    const scope: Scope = {
      id: ScopeId.make(organizationId),
      name: organizationName,
      createdAt: new Date(),
    };

    const services = yield* makePostgresServices(db, {
      scope,
      encryptionKey,
    });

    return yield* createExecutor({
      scope,
      ...services,
      plugins: [
        openApiPlugin(),
        mcpPlugin(),
        googleDiscoveryPlugin(),
        graphqlPlugin(),
      ] as const,
    });
  });
