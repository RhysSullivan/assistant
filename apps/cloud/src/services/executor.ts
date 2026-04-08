// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, from Postgres
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { createExecutor } from "@executor-js/core";
import type { DrizzleDb } from "@executor/storage-postgres";
import { makePgConfig, makePgKv } from "@executor/storage-postgres";
import {
  openApiPlugin,
  makeKvOperationStore,
} from "@executor-js/plugin-openapi/core";
import {
  mcpPlugin,
  makeKvBindingStore,
} from "@executor-js/plugin-mcp/core";
import {
  googleDiscoveryPlugin,
  makeKvBindingStore as makeKvGoogleDiscoveryBindingStore,
} from "@executor-js/plugin-google-discovery/core";
import {
  graphqlPlugin,
  makeKvOperationStore as makeKvGraphqlOperationStore,
} from "@executor-js/plugin-graphql/core";
import { DbService } from "./db";

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
    const kv = makePgKv(db, organizationId);
    const config = makePgConfig(db, {
      organizationId,
      organizationName,
      encryptionKey,
      plugins: [
        openApiPlugin({
          operationStore: makeKvOperationStore(kv, "openapi"),
        }),
        mcpPlugin({
          bindingStore: makeKvBindingStore(kv, "mcp"),
        }),
        googleDiscoveryPlugin({
          bindingStore: makeKvGoogleDiscoveryBindingStore(kv, "google-discovery"),
        }),
        graphqlPlugin({
          operationStore: makeKvGraphqlOperationStore(kv, "graphql"),
        }),
      ] as const,
    });

    return yield* createExecutor(config);
  });
