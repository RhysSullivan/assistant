// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, with Vault-backed secrets
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { WorkOS } from "@workos-inc/node/worker";

import { ScopeId, createExecutor, makeInMemorySourceRegistry, scopeKv } from "@executor/sdk";
import { makePgKv, makePgPolicyEngine, makePgToolRegistry } from "@executor/storage-postgres";
import { openApiPlugin, makeKvOperationStore } from "@executor/plugin-openapi";
import { mcpPlugin, makeKvBindingStore } from "@executor/plugin-mcp";
import {
  googleDiscoveryPlugin,
  makeKvBindingStore as makeKvGoogleDiscoveryBindingStore,
} from "@executor/plugin-google-discovery";
import {
  graphqlPlugin,
  makeKvOperationStore as makeKvGraphqlOperationStore,
} from "@executor/plugin-graphql";
import {
  makeWorkOSVaultClient,
  makeWorkOSVaultSecretStore,
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
    const workos = new WorkOS({
      apiKey: server.WORKOS_API_KEY,
      clientId: server.WORKOS_CLIENT_ID,
    });
    const vaultClient = makeWorkOSVaultClient(workos);

    return yield* createExecutor({
      scope: {
        id: ScopeId.make(organizationId),
        name: organizationName,
        createdAt: new Date(),
      },
      tools: makePgToolRegistry(db, organizationId),
      sources: makeInMemorySourceRegistry(),
      secrets: makeWorkOSVaultSecretStore({
        client: vaultClient,
        metadataStore: scopeKv(kv, "secrets"),
        scopeId: organizationId,
      }),
      policies: makePgPolicyEngine(db, organizationId),
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
        workosVaultPlugin(),
      ] as const,
    });
  });
