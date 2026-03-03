import {
  ControlPlaneService,
  makeControlPlaneService,
  makeControlPlaneSourcesService,
  fetchOpenApiDocument,
  makeControlPlaneWebHandler,
  makeSourceCatalogService,
  makeSourceManagerService,
} from "@executor-v2/management-api";
import {
  RuntimeAdapterError,
  makeGraphqlToolProvider,
  makeMcpToolProvider,
  createRunExecutor,
  createSourceToolRegistry,
  invokeRuntimeToolCallResult,
  makeOpenApiToolProvider,
  makeRuntimeAdapterRegistry,
  makeToolProviderRegistry,
} from "@executor-v2/engine";
import {
  makeSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "@executor-v2/persistence-sql";
import {
  type AccountId,
  type OrganizationId,
  type OrganizationMemberId,
  type ProfileId,
  type WorkspaceId,
} from "@executor-v2/schema";
import { type RuntimeToolCallResult } from "@executor-v2/sdk";
import { makeCloudflareWorkerLoaderRuntimeAdapter } from "@executor-v2/runtime-cloudflare-worker-loader";
import { makeDenoSubprocessRuntimeAdapter } from "@executor-v2/runtime-deno-subprocess";
import { makeLocalInProcessRuntimeAdapter } from "@executor-v2/runtime-local-inproc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PmActorLive } from "./actor";
import {
  createPmApprovalsService,
  createPmPersistentToolApprovalPolicy,
} from "./approvals-service";
import { startPmHttpServer } from "./http-server";
import { createPmPoliciesService } from "./policies-service";
import { createPmCredentialsService } from "./credentials-service";
import { createPmOrganizationsService } from "./organizations-service";
import { createPmStorageService } from "./storage-service";
import { createPmToolsService } from "./tools-service";
import { createPmWorkspacesService } from "./workspaces-service";
import { createPmMcpHandler } from "./mcp-handler";
import { createPmExecuteRuntimeRun } from "./runtime-execution-port";
import { createPmToolCallHttpHandler } from "./tool-call-handler";
import { readPmEnvironment } from "./env";

const formatRuntimeAdapterError = (error: RuntimeAdapterError): string =>
  error.details ? `${error.message}: ${error.details}` : error.message;

const env = readPmEnvironment();
const port = env.port;
const workspaceId = env.workspaceId as WorkspaceId;
const requireToolApprovals = env.requireToolApprovals;
const defaultToolExposureMode = env.defaultToolExposureMode;

const ensurePmBootstrap = (
  persistence: SqlControlPlanePersistence,
) =>
  Effect.gen(function* () {
    const now = Date.now();

    const organizationId = "org_local" as OrganizationId;
    const accountId = "acct_local" as AccountId;

    const [organizationOption, membershipOption, workspaceOption, profileOption] = yield* Effect.all([
      persistence.rows.organizations.getById(organizationId),
      persistence.rows.organizationMemberships.getByOrganizationAndAccount(
        organizationId,
        accountId,
      ),
      persistence.rows.workspaces.getById(workspaceId),
      persistence.rows.profile.get(),
    ]);

    if (organizationOption._tag === "None") {
      yield* persistence.rows.organizations.upsert({
        id: organizationId,
        slug: organizationId,
        name: "Local Organization",
        status: "active",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (membershipOption._tag === "None") {
      yield* persistence.rows.organizationMemberships.upsert({
        id: "org_member_local" as OrganizationMemberId,
        organizationId,
        accountId,
        role: "owner",
        status: "active",
        billable: false,
        invitedByAccountId: null,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (workspaceOption._tag === "None") {
      yield* persistence.rows.workspaces.upsert({
        id: workspaceId,
        organizationId,
        name: "Local Workspace",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (profileOption._tag === "None") {
      yield* persistence.rows.profile.upsert({
        id: "profile_local" as ProfileId,
        defaultWorkspaceId: workspaceId,
        displayName: "Local",
        runtimeMode: "local",
        createdAt: now,
        updatedAt: now,
      });
    }
  });

const pmRuntimeAdapters = [
  makeLocalInProcessRuntimeAdapter(),
  makeDenoSubprocessRuntimeAdapter(),
  makeCloudflareWorkerLoaderRuntimeAdapter(),
];

const runtimeAdapters = makeRuntimeAdapterRegistry(pmRuntimeAdapters);
const defaultRuntimeKind =
  env.runtimeKind ?? pmRuntimeAdapters[0].kind;

const persistence: SqlControlPlanePersistence = await Effect.runPromise(
  makeSqlControlPlanePersistence({
    databaseUrl: env.controlPlaneDatabaseUrl,
    localDataDir: env.controlPlaneDataDir,
    postgresApplicationName: "executor-v2-pm",
  }),
);

const sourceStore = persistence.sourceStore;
const toolArtifactStore = persistence.toolArtifactStore;

await Effect.runPromise(ensurePmBootstrap(persistence));

const sourceCatalog = makeSourceCatalogService(sourceStore);
const sourceManager = makeSourceManagerService(toolArtifactStore);
const baseSourcesService = makeControlPlaneSourcesService(sourceCatalog);
const sourcesService = {
  ...baseSourcesService,
  upsertSource: (input: Parameters<typeof baseSourcesService.upsertSource>[0]) =>
    Effect.gen(function* () {
      const source = yield* baseSourcesService.upsertSource(input);

      if (source.kind !== "openapi") {
        return source;
      }

      const openApiSpecResult = yield* Effect.tryPromise({
        try: () => fetchOpenApiDocument(source.endpoint),
        catch: (cause) => String(cause),
      }).pipe(Effect.either);

      if (openApiSpecResult._tag === "Left") {
        return source;
      }

      yield* sourceManager
        .refreshOpenApiArtifact({
          source,
          openApiSpec: openApiSpecResult.right,
        })
        .pipe(Effect.ignore);

      return source;
    }),
};

const credentialsService = createPmCredentialsService(persistence.rows);
const policiesService = createPmPoliciesService(persistence.rows);
const organizationsService = createPmOrganizationsService(persistence.rows);
const workspacesService = createPmWorkspacesService(persistence.rows);
const toolsService = createPmToolsService(sourceStore, toolArtifactStore);
const storageService = createPmStorageService(persistence.rows, {
  stateRootDir: env.stateRootDir,
});
const approvalsService = createPmApprovalsService(persistence.rows);
const controlPlaneService = makeControlPlaneService({
  sources: sourcesService,
  credentials: credentialsService,
  policies: policiesService,
  organizations: organizationsService,
  workspaces: workspacesService,
  tools: toolsService,
  storage: storageService,
  approvals: approvalsService,
});

const controlPlaneWebHandler = makeControlPlaneWebHandler(
  Layer.succeed(ControlPlaneService, controlPlaneService),
  PmActorLive(persistence.rows),
);

const toolProviderRegistry = makeToolProviderRegistry([
  makeOpenApiToolProvider(),
  makeMcpToolProvider(),
  makeGraphqlToolProvider(),
]);
const persistentApprovalPolicy = createPmPersistentToolApprovalPolicy(persistence.rows, {
  requireApprovals: requireToolApprovals,
});
const toolRegistry = createSourceToolRegistry({
  workspaceId,
  sourceStore,
  toolArtifactStore,
  toolProviderRegistry,
  approvalPolicy: persistentApprovalPolicy,
});
const executeRuntimeRun = createPmExecuteRuntimeRun({
  defaultRuntimeKind,
  runtimeAdapters,
  toolRegistry,
});

const runExecutor = createRunExecutor(executeRuntimeRun);
const handleMcp = createPmMcpHandler(runExecutor.executeRun, {
  toolRegistry,
  defaultToolExposureMode,
});

const handleToolCallHttp = createPmToolCallHttpHandler((input) =>
  Effect.runPromise(
    invokeRuntimeToolCallResult(toolRegistry, input).pipe(
      Effect.catchTag("RuntimeAdapterError", (error) =>
        Effect.succeed<RuntimeToolCallResult>({
          ok: false,
          kind: "failed",
          error: formatRuntimeAdapterError(error),
        }),
      ),
    ),
  ),
);

const server = startPmHttpServer({
  port,
  handleMcp,
  handleToolCall: handleToolCallHttp,
  handleControlPlane: controlPlaneWebHandler.handler,
});

const shutdown = async () => {
  server.stop();
  await controlPlaneWebHandler.dispose();
  await persistence.close();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
