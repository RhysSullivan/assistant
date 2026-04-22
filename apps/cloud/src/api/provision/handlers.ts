// ---------------------------------------------------------------------------
// Provisioning handlers — reuse the exact services the UI flow touches.
//
// create-org: WorkOSAuth.createOrganization + UserStoreService.upsertOrganization,
//             identical to /auth/create-organization's flow minus session
//             attachment (we have no user session to re-seal).
// put-secrets: executor.secrets.set(...) — same call path as the UI's
//              Secrets page.
// add-integrations: executor.mcp.addSource / executor.openapi.addSpec — same
//                   call path as /scopes/:scopeId/mcp/sources and
//                   /scopes/:scopeId/openapi/specs.
//
// Building a temporary executor per org is the same per-request wiring the
// protected HTTP app already does via `makeExecutionStack`; we just use a
// synthetic user id (see `PROVISION_USER_ID`) because there's no WorkOS
// session in scope.
// ---------------------------------------------------------------------------

import { HttpApiBuilder } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import {
  Scope,
  ScopeId,
  SecretId,
  SetSecretInput,
  collectSchemas,
  createExecutor,
} from "@executor/sdk";
import {
  makePostgresAdapter,
  makePostgresBlobStore,
} from "@executor/storage-postgres";
import { openApiPlugin } from "@executor/plugin-openapi";
import { mcpPlugin } from "@executor/plugin-mcp";
import { graphqlPlugin } from "@executor/plugin-graphql";
import {
  workosVaultPlugin,
  type WorkOSVaultPluginOptions,
} from "@executor/plugin-workos-vault";
import { env } from "cloudflare:workers";

import { UserStoreService } from "../../auth/context";
import { WorkOSAuth } from "../../auth/workos";
import { DbService } from "../../services/db";

import { ProvisionError, ProvisionHttpApi } from "./api";
import { ProvisionOperatorContext } from "./middleware";

// ---------------------------------------------------------------------------
// Synthetic user used when building an executor for provisioning. The
// user-org scope exists to satisfy the executor stack — provisioning only
// writes at the org scope, but the executor requires a stack of ≥1 scope
// and the plugins' OAuth paths key off the inner scope.
// ---------------------------------------------------------------------------

const PROVISION_USER_ID = "provision";

const userOrgScopeId = (userId: string, orgId: string) =>
  `user-org:${userId}:${orgId}`;

// ---------------------------------------------------------------------------
// Vault plugin config — Context-injected so tests can swap in a fake
// WorkOSVaultClient (see handlers.node.test.ts). Prod wires it to the real
// credentials via `ProvisionVaultOptionsLive`.
// ---------------------------------------------------------------------------

export class ProvisionVaultOptions extends Context.Tag(
  "@executor/cloud/ProvisionVaultOptions",
)<ProvisionVaultOptions, WorkOSVaultPluginOptions>() {}

export const ProvisionVaultOptionsLive = Layer.sync(
  ProvisionVaultOptions,
  () => ({
    credentials: {
      apiKey: env.WORKOS_API_KEY,
      clientId: env.WORKOS_CLIENT_ID,
    },
  }),
);

// ---------------------------------------------------------------------------
// Executor factory — mirrors services/executor.ts#createScopedExecutor.
// Intentionally duplicated (not imported) to (a) allow DI of the workos-vault
// client in tests and (b) stay resilient to the real one changing auth
// shape. Both are small enough to drift together without pain.
// ---------------------------------------------------------------------------

const buildOrgExecutor = (orgId: string, orgName: string) =>
  Effect.gen(function* () {
    const { db } = yield* DbService;
    const vaultOptions = yield* ProvisionVaultOptions;
    const vault = workosVaultPlugin(vaultOptions);
    const plugins = [
      openApiPlugin(),
      mcpPlugin({ dangerouslyAllowStdioMCP: false }),
      graphqlPlugin(),
      vault,
    ] as const;
    const schema = collectSchemas(plugins);
    const adapter = makePostgresAdapter({ db, schema });
    const blobs = makePostgresBlobStore({ db });

    const orgScope = new Scope({
      id: ScopeId.make(orgId),
      name: orgName,
      createdAt: new Date(),
    });
    const userOrgScope = new Scope({
      id: ScopeId.make(userOrgScopeId(PROVISION_USER_ID, orgId)),
      name: `Provision · ${orgName}`,
      createdAt: new Date(),
    });

    return yield* createExecutor({
      scopes: [userOrgScope, orgScope],
      adapter,
      blobs,
      plugins,
    });
  });

type OrgExecutor = Effect.Effect.Success<ReturnType<typeof buildOrgExecutor>>;

// ---------------------------------------------------------------------------
// Shared domain helpers — each returns the response shape the API group
// declares, so handlers compose them directly.
// ---------------------------------------------------------------------------

type SecretInputShape = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly scope?: string;
  readonly provider?: string;
};

type McpIntegrationShape = {
  readonly kind: "mcp";
  readonly name: string;
  readonly endpoint: string;
  readonly namespace?: string;
  readonly remoteTransport?: "streamable-http" | "sse" | "auto";
  readonly headers?: Readonly<Record<string, string>>;
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly auth?:
    | { readonly kind: "none" }
    | {
        readonly kind: "header";
        readonly headerName: string;
        readonly secretId: string;
        readonly prefix?: string;
      };
  readonly scope?: string;
};

type OpenApiIntegrationShape = {
  readonly kind: "openapi";
  readonly name?: string;
  readonly namespace?: string;
  readonly spec: string;
  readonly baseUrl?: string;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly scope?: string;
};

type IntegrationShape = McpIntegrationShape | OpenApiIntegrationShape;

const describeError = (err: unknown): string => {
  if (err && typeof err === "object" && "_tag" in err && typeof err._tag === "string") {
    return err._tag;
  }
  if (err instanceof Error) return err.message;
  return String(err);
};

const writeSecrets = (
  executor: OrgExecutor,
  orgId: string,
  secrets: ReadonlyArray<SecretInputShape>,
) =>
  Effect.forEach(
    secrets,
    (s) =>
      executor.secrets
        .set(
          new SetSecretInput({
            id: SecretId.make(s.id),
            scope: ScopeId.make(s.scope ?? orgId),
            name: s.name,
            value: s.value,
            provider: s.provider,
          }),
        )
        .pipe(
          Effect.map((ref) => ({
            id: ref.id as string,
            scope: ref.scopeId as string,
            name: ref.name,
            provider: ref.provider,
          })),
          Effect.mapError(
            (err) =>
              new ProvisionError({
                code: "secret_write_failed",
                message: `Failed to set secret ${s.id}: ${describeError(err)}`,
              }),
          ),
        ),
    { concurrency: 1 },
  );

const addIntegration = (
  executor: OrgExecutor,
  orgId: string,
  integration: IntegrationShape,
) =>
  Effect.gen(function* () {
    const targetScope = integration.scope ?? orgId;
    if (integration.kind === "mcp") {
      const result = yield* executor.mcp
        .addSource({
          transport: "remote",
          scope: targetScope,
          name: integration.name,
          endpoint: integration.endpoint,
          remoteTransport: integration.remoteTransport,
          namespace: integration.namespace,
          headers: integration.headers
            ? { ...integration.headers }
            : undefined,
          queryParams: integration.queryParams
            ? { ...integration.queryParams }
            : undefined,
          auth: integration.auth,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ProvisionError({
                code: "mcp_add_failed",
                message: `Failed to add MCP source ${integration.name}: ${describeError(err)}`,
              }),
          ),
        );
      return {
        kind: "mcp" as const,
        namespace: result.namespace,
        toolCount: result.toolCount,
        scope: targetScope,
      };
    }
    const result = yield* executor.openapi
      .addSpec({
        spec: integration.spec,
        scope: targetScope,
        name: integration.name,
        baseUrl: integration.baseUrl,
        namespace: integration.namespace,
        headers: integration.headers as Record<string, never> | undefined,
      })
      .pipe(
        Effect.mapError(
          (err) =>
            new ProvisionError({
              code: "openapi_add_failed",
              message: `Failed to add OpenAPI spec ${
                integration.name ?? integration.namespace ?? "(unnamed)"
              }: ${describeError(err)}`,
            }),
        ),
      );
    return {
      kind: "openapi" as const,
      namespace: result.sourceId,
      toolCount: result.toolCount,
      scope: targetScope,
    };
  });

const addIntegrations = (
  executor: OrgExecutor,
  orgId: string,
  integrations: ReadonlyArray<IntegrationShape>,
) =>
  Effect.forEach(integrations, (i) => addIntegration(executor, orgId, i), {
    concurrency: 1,
  });

// ---------------------------------------------------------------------------
// Org creation — mirrors auth/handlers.ts#createOrganization minus the
// WorkOS session attach (no user session in scope).
// ---------------------------------------------------------------------------

const createOrg = (name: string) =>
  Effect.gen(function* () {
    const operator = yield* ProvisionOperatorContext;
    const workos = yield* WorkOSAuth;
    const users = yield* UserStoreService;

    const trimmed = name.trim();
    if (!trimmed) {
      return yield* new ProvisionError({
        code: "invalid_name",
        message: "Organization name must be non-empty",
      });
    }

    const org = yield* workos.createOrganization(trimmed).pipe(
      Effect.mapError(
        (err) =>
          new ProvisionError({
            code: "workos_create_failed",
            message: `Failed to create organization in WorkOS: ${describeError(err)}`,
          }),
      ),
    );
    yield* users
      .use((s) => s.upsertOrganization({ id: org.id, name: org.name }))
      .pipe(
        Effect.mapError(
          (err) =>
            new ProvisionError({
              code: "local_mirror_failed",
              message: `Failed to mirror organization locally: ${describeError(err)}`,
            }),
        ),
      );

    yield* Effect.logInfo("provision.createOrg", {
      orgId: org.id,
      operatorId: operator.operatorId,
    });

    // `adminToken` currently echoes the operator bearer so automation can
    // stay on a single token. A follow-up can mint per-org tokens here
    // once operator-accounts land.
    return {
      orgId: org.id,
      name: org.name,
      adminToken: env.PROVISION_API_TOKEN ?? "",
    };
  });

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const ProvisionHandlers = HttpApiBuilder.group(
  ProvisionHttpApi,
  "provision",
  (handlers) =>
    handlers
      .handle("createOrg", ({ payload }) => createOrg(payload.name))
      .handle("putSecrets", ({ path, payload }) =>
        Effect.gen(function* () {
          const executor = yield* buildOrgExecutor(path.orgId, path.orgId).pipe(
            Effect.mapError(
              (err) =>
                new ProvisionError({
                  code: "executor_build_failed",
                  message: `Failed to build executor for org ${path.orgId}: ${err.message}`,
                }),
            ),
          );
          const secrets = yield* writeSecrets(
            executor,
            path.orgId,
            payload.secrets,
          );
          return { secrets };
        }),
      )
      .handle("addIntegrations", ({ path, payload }) =>
        Effect.gen(function* () {
          const executor = yield* buildOrgExecutor(path.orgId, path.orgId).pipe(
            Effect.mapError(
              (err) =>
                new ProvisionError({
                  code: "executor_build_failed",
                  message: `Failed to build executor for org ${path.orgId}: ${err.message}`,
                }),
            ),
          );
          const integrations = yield* addIntegrations(
            executor,
            path.orgId,
            payload.integrations as ReadonlyArray<IntegrationShape>,
          );
          return { integrations };
        }),
      )
      .handle("provision", ({ payload }) =>
        Effect.gen(function* () {
          const createdOrg = yield* createOrg(payload.org.name);
          const executor = yield* buildOrgExecutor(
            createdOrg.orgId,
            createdOrg.name,
          ).pipe(
            Effect.mapError(
              (err) =>
                new ProvisionError({
                  code: "executor_build_failed",
                  message: `Failed to build executor for org ${createdOrg.orgId}: ${err.message}`,
                }),
            ),
          );

          const secrets = payload.secrets
            ? yield* writeSecrets(executor, createdOrg.orgId, payload.secrets)
            : [];
          const integrations = payload.integrations
            ? yield* addIntegrations(
                executor,
                createdOrg.orgId,
                payload.integrations as ReadonlyArray<IntegrationShape>,
              )
            : [];
          return { org: createdOrg, secrets, integrations };
        }),
      ),
);

