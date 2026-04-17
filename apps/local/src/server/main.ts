import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
} from "@effect/platform";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

import {
  addGroup,
  observabilityMiddleware,
  withCapture,
} from "@executor/api";
import { CoreHandlers, ExecutorService, ExecutionEngineService } from "@executor/api/server";
import { createExecutionEngine } from "@executor/execution";
import {
  OpenApiGroup,
  OpenApiHandlers,
  OpenApiExtensionService,
} from "@executor/plugin-openapi/api";
import { McpGroup, McpHandlers, McpExtensionService } from "@executor/plugin-mcp/api";
import {
  GoogleDiscoveryGroup,
  GoogleDiscoveryHandlers,
  GoogleDiscoveryExtensionService,
} from "@executor/plugin-google-discovery/api";
import {
  OnePasswordGroup,
  OnePasswordHandlers,
  OnePasswordExtensionService,
} from "@executor/plugin-onepassword/api";
import {
  GraphqlGroup,
  GraphqlHandlers,
  GraphqlExtensionService,
} from "@executor/plugin-graphql/api";
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

const LocalApiBase = HttpApiBuilder.api(LocalApi).pipe(
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
  const engine = createExecutionEngine({ executor });

  // `withCapture` wraps the executor once — every Effect-returning
  // method on core + every plugin extension translates `StorageError`
  // to `InternalError({ traceId })` via `ErrorCapture`;
  // `UniqueViolationError` becomes a defect. Handlers see the
  // already-captured shape.
  const wrapped = withCapture(executor);
  const pluginExtensions = Layer.mergeAll(
    Layer.succeed(OpenApiExtensionService, wrapped.openapi),
    Layer.succeed(McpExtensionService, wrapped.mcp),
    Layer.succeed(GoogleDiscoveryExtensionService, wrapped.googleDiscovery),
    Layer.succeed(OnePasswordExtensionService, wrapped.onepassword),
    Layer.succeed(GraphqlExtensionService, wrapped.graphql),
  );

  const api = HttpApiBuilder.toWebHandler(
    HttpApiSwagger.layer({ path: "/docs" }).pipe(
      Layer.provideMerge(HttpApiBuilder.middlewareOpenApi()),
      Layer.provideMerge(LocalApiBase),
      Layer.provideMerge(pluginExtensions),
      Layer.provideMerge(Layer.succeed(ExecutorService, executor)),
      Layer.provideMerge(Layer.succeed(ExecutionEngineService, engine)),
      Layer.provideMerge(HttpServer.layerContext),
      Layer.provideMerge(HttpRouter.setRouterConfig({ maxParamLength: 1000 })),
    ),
    { middleware: HttpMiddleware.logger },
  );

  const mcp = createMcpRequestHandler({ engine });

  return { api, mcp };
};

export class ServerHandlersService extends Context.Tag("@executor/local/ServerHandlersService")<
  ServerHandlersService,
  ServerHandlers
>() {}

const ServerHandlersLive = Layer.scoped(
  ServerHandlersService,
  Effect.acquireRelease(
    Effect.promise(() => createServerHandlers()),
    (handlers) => Effect.promise(() => closeServerHandlers(handlers)),
  ),
);

const serverHandlersRuntime = ManagedRuntime.make(ServerHandlersLive);

export const getServerHandlers = (): Promise<ServerHandlers> =>
  serverHandlersRuntime.runPromise(ServerHandlersService);

export const disposeServerHandlers = async (): Promise<void> => {
  await serverHandlersRuntime.dispose().catch(() => undefined);
};
