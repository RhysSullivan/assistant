import * as BunContext from "@effect/platform-bun/BunContext";
import {
  ControlPlaneService,
  makeControlPlaneService,
  makeControlPlaneSourcesService,
  makeControlPlaneWebHandler,
  makeSourceCatalogService,
} from "@executor-v2/management-api";
import {
  createRunExecutor,
  createRuntimeToolCallHandler,
  createUnimplementedRuntimeToolInvoker,
  makeRuntimeAdapterRegistry,
  makeToolProviderRegistry,
} from "@executor-v2/engine";
import {
  makeLocalSourceStore,
  makeLocalStateStore,
} from "@executor-v2/persistence-local";
import { makeCloudflareWorkerLoaderRuntimeAdapter } from "@executor-v2/runtime-cloudflare-worker-loader";
import { makeDenoSubprocessRuntimeAdapter } from "@executor-v2/runtime-deno-subprocess";
import { makeLocalInProcessRuntimeAdapter } from "@executor-v2/runtime-local-inproc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PmActorLive } from "./actor";
import { createPmApprovalsService } from "./approvals-service";
import { createPmResolveToolCredentials } from "./credential-resolver";
import { startPmHttpServer } from "./http-server";
import { createPmMcpHandler } from "./mcp-handler";
import { createPmExecuteRuntimeRun } from "./runtime-execution-port";
import { createPmToolCallHttpHandler } from "./tool-call-handler";

const pmStateRootDir = process.env.PM_STATE_ROOT_DIR ?? ".executor-v2/pm-state";

const parsePort = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8787;
};

const readConfiguredRuntimeKind = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const port = parsePort(process.env.PORT);

const pmRuntimeAdapters = [
  makeLocalInProcessRuntimeAdapter(),
  makeDenoSubprocessRuntimeAdapter(),
  makeCloudflareWorkerLoaderRuntimeAdapter(),
];

const runtimeAdapters = makeRuntimeAdapterRegistry(pmRuntimeAdapters);
const toolProviders = makeToolProviderRegistry([]);

const defaultRuntimeKind =
  readConfiguredRuntimeKind(process.env.PM_RUNTIME_KIND) ?? pmRuntimeAdapters[0].kind;

const sourceStore = await Effect.runPromise(
  makeLocalSourceStore({
    rootDir: pmStateRootDir,
  }).pipe(Effect.provide(BunContext.layer)),
);

const localStateStore = await Effect.runPromise(
  makeLocalStateStore({
    rootDir: pmStateRootDir,
  }).pipe(Effect.provide(BunContext.layer)),
);

const sourceCatalog = makeSourceCatalogService(sourceStore);
const approvalsService = createPmApprovalsService(localStateStore);
const controlPlaneService = makeControlPlaneService({
  sources: makeControlPlaneSourcesService(sourceCatalog),
  approvals: approvalsService,
});

const controlPlaneWebHandler = makeControlPlaneWebHandler(
  Layer.succeed(ControlPlaneService, controlPlaneService),
  PmActorLive(localStateStore),
);

const executeRuntimeRun = createPmExecuteRuntimeRun({
  defaultRuntimeKind,
  runtimeAdapters,
  toolProviders,
});

const runExecutor = createRunExecutor(executeRuntimeRun);
const handleMcp = createPmMcpHandler(runExecutor.executeRun);

const resolveCredentials = createPmResolveToolCredentials(localStateStore);
const invokeRuntimeTool = createUnimplementedRuntimeToolInvoker("pm");
const handleToolCall = createRuntimeToolCallHandler({
  resolveCredentials,
  invokeRuntimeTool,
});

const handleToolCallHttp = createPmToolCallHttpHandler((input) =>
  Effect.runPromise(handleToolCall(input)),
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
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
