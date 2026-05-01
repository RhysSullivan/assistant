import { HttpApiBuilder, HttpApiSwagger } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

import { addGroup, observabilityMiddleware } from "@executor-js/api";
import { CoreHandlers, ExecutorService, ExecutionEngineService } from "@executor-js/api/server";
import { createExecutionEngine } from "@executor-js/execution";
import { makeQuickJsExecutor } from "@executor-js/runtime-quickjs";
import {
  OpenApiGroup,
  OpenApiHandlers,
  OpenApiExtensionService,
} from "@executor-js/plugin-openapi/api";
import { McpGroup, McpHandlers, McpExtensionService } from "@executor-js/plugin-mcp/api";
import {
  GoogleDiscoveryGroup,
  GoogleDiscoveryHandlers,
  GoogleDiscoveryExtensionService,
} from "@executor-js/plugin-google-discovery/api";
import {
  OnePasswordGroup,
  OnePasswordHandlers,
  OnePasswordExtensionService,
} from "@executor-js/plugin-onepassword/api";
import {
  GraphqlGroup,
  GraphqlHandlers,
  GraphqlExtensionService,
} from "@executor-js/plugin-graphql/api";
import { getExecutor } from "./executor";
import { createMcpRequestHandler, type McpRequestHandler } from "./mcp";
import { ErrorCaptureLive } from "./observability";

// ---------------------------------------------------------------------------
// Local server API — core + all plugin groups
// ---------------------------------------------------------------------------

const LocalApi = addGroup(OpenApiGroup)
  .add(McpGroup)
  .add(GoogleDiscoveryGroup)
  .add(OnePasswordGroup)
  .add(GraphqlGroup);

// `ErrorCaptureLive` logs causes to the console and returns a short
// correlation id. Provided above the handler + middleware layers so
// both the `withCapture` typed-channel translation AND the
// `observabilityMiddleware` defect catchall see the same
// implementation.
const LocalObservability = observabilityMiddleware(LocalApi);

const LocalApiBase = HttpApiBuilder.layer(LocalApi).pipe(
  Layer.provide(CoreHandlers),
  Layer.provide(
    Layer.mergeAll(
      OpenApiHandlers,
      McpHandlers,
      GoogleDiscoveryHandlers,
      OnePasswordHandlers,
      GraphqlHandlers,
    ),
  ),
  Layer.provide(LocalObservability),
  Layer.provide(ErrorCaptureLive),
);

// ---------------------------------------------------------------------------
// Server handlers
// ---------------------------------------------------------------------------

export type ServerHandlers = {
  readonly api: {
    readonly handler: (request: Request) => Promise<Response>;
    readonly dispose: () => Promise<void>;
  };
  readonly mcp: McpRequestHandler;
};

const closeServerHandlers = async (handlers: ServerHandlers): Promise<void> => {
  await Promise.all([
    handlers.api.dispose().catch(() => undefined),
    handlers.mcp.close().catch(() => undefined),
  ]);
};

export const createServerHandlers = async (): Promise<ServerHandlers> => {
  const executor = await getExecutor();
  const engine = createExecutionEngine({ executor, codeExecutor: makeQuickJsExecutor() });

  // Handlers wrap their own bodies with `capture(...)` — the edge
  // translation lives per-handler, not at service construction.
  const pluginExtensions = Layer.mergeAll(
    Layer.succeed(OpenApiExtensionService)(executor.openapi),
    Layer.succeed(McpExtensionService)(executor.mcp),
    Layer.succeed(GoogleDiscoveryExtensionService)(executor.googleDiscovery),
    Layer.succeed(OnePasswordExtensionService)(executor.onepassword),
    Layer.succeed(GraphqlExtensionService)(executor.graphql),
  );

  const localApiLayer = LocalApiBase.pipe(
    Layer.provideMerge(HttpApiSwagger.layer(LocalApi, { path: "/docs" })),
    Layer.provideMerge(pluginExtensions),
    Layer.provideMerge(Layer.succeed(ExecutorService)(executor)),
    Layer.provideMerge(Layer.succeed(ExecutionEngineService)(engine)),
    Layer.provideMerge(HttpServer.layerServices),
    Layer.provideMerge(Layer.succeed(HttpRouter.RouterConfig)({ maxParamLength: 1000 })),
  );
  const api = HttpRouter.toWebHandler(localApiLayer);
  const apiHandler: ServerHandlers["api"] = {
    handler: (request) => api.handler(request),
    dispose: api.dispose,
  };

  const mcp = createMcpRequestHandler({ engine });

  return { api: apiHandler, mcp };
};

export class ServerHandlersService extends Context.Service<ServerHandlersService, ServerHandlers
>()("@executor-js/local/ServerHandlersService") {}

const ServerHandlersLive = Layer.effect(ServerHandlersService)(Effect.acquireRelease(
    Effect.promise(() => createServerHandlers()),
    (handlers) => Effect.promise(() => closeServerHandlers(handlers)),
  ),
);

const serverHandlersRuntime = ManagedRuntime.make(ServerHandlersLive);

export const getServerHandlers = (): Promise<ServerHandlers> =>
  serverHandlersRuntime.runPromise(ServerHandlersService.asEffect());

export const disposeServerHandlers = async (): Promise<void> => {
  await serverHandlersRuntime.dispose().catch(() => undefined);
};
