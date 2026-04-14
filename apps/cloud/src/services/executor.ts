// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, with Vault-backed secrets
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { ScopeId, createExecutor, makeInMemorySourceRegistry, scopeKv } from "@executor/sdk";
import { makePgKv, makePgPolicyEngine, makePgToolRegistry } from "@executor/storage-postgres";
import { openApiPlugin, makeKvOperationStore } from "@executor/plugin-openapi";
import { mcpPlugin, makeKvBindingStore } from "@executor/plugin-mcp";
import {
  graphqlPlugin,
  makeKvOperationStore as makeKvGraphqlOperationStore,
} from "@executor/plugin-graphql";
import {
  makeConfiguredWorkOSVaultSecretStore,
  workosVaultPlugin,
} from "@executor/plugin-workos-vault";
import { DbService } from "./db";
import { server } from "../env";

// ---------------------------------------------------------------------------
// Create a fresh executor for an organization (stateless, per-request)
// ---------------------------------------------------------------------------

export const createOrgExecutor = (
  organizationId: string,
  organizationName: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbService;
    const kv = makePgKv(db, organizationId);
    const secrets = yield* makeConfiguredWorkOSVaultSecretStore({
      credentials: {
        apiKey: server.WORKOS_API_KEY,
        clientId: server.WORKOS_CLIENT_ID,
      },
      metadataStore: scopeKv(kv, "secrets"),
      scopeId: organizationId,
    }).pipe(Effect.orDie);

    return yield* createExecutor({
      scope: {
        id: ScopeId.make(organizationId),
        name: organizationName,
        createdAt: new Date(),
      },
      tools: makePgToolRegistry(db, organizationId),
      sources: makeInMemorySourceRegistry(),
      secrets,
      policies: makePgPolicyEngine(db, organizationId),
      plugins: [
        openApiPlugin({
          operationStore: makeKvOperationStore(kv, "openapi"),
        }),
        mcpPlugin({
          bindingStore: makeKvBindingStore(kv, "mcp"),
        }),
        graphqlPlugin({
          operationStore: makeKvGraphqlOperationStore(kv, "graphql"),
        }),
        workosVaultPlugin(),
      ] as const,
    });
  });
