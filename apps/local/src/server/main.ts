import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
} from "@effect/platform";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

import { CoreHandlers, ExecutorService, ExecutionEngineService } from "@executor/api/server";
import { createExecutionEngine } from "@executor/execution";
import { getExecutor } from "./executor";
import { createMcpRequestHandler, type McpRequestHandler } from "./mcp";
import { createLocalPluginExtensions, LocalApi, LocalPluginHandlers } from "./plugin-registry";

// ---------------------------------------------------------------------------
// Local server API — core + all plugin groups
// ---------------------------------------------------------------------------

const LocalApiBase = HttpApiBuilder.api(LocalApi).pipe(
  Layer.provide(CoreHandlers),
  Layer.provide(LocalPluginHandlers),
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

  const pluginExtensions = createLocalPluginExtensions(executor);

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
