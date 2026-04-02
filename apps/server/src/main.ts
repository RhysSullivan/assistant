import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
  HttpServer,
} from "@effect/platform";
import { Layer } from "effect";

import { addGroup } from "@executor/api";
import { OpenApiGroup } from "@executor/plugin-openapi/api";
import { McpGroup } from "@executor/plugin-mcp/api";
import { OnePasswordGroup } from "@executor/plugin-onepassword/api";
import { ToolsHandlers } from "./handlers/tools";
import { SourcesHandlers } from "./handlers/sources";
import { SecretsHandlers } from "./handlers/secrets";
import { OpenApiHandlersLive } from "./handlers/openapi";
import { McpSourceHandlersLive } from "./handlers/mcp-source";
import { OnePasswordHandlersLive } from "./handlers/onepassword";
import { ExecutorServiceLayer, getExecutor } from "./services/executor";
import { createMcpRequestHandler, type McpRequestHandler } from "./mcp";

// ---------------------------------------------------------------------------
// Composed API — core + plugin groups
// ---------------------------------------------------------------------------

const ExecutorApiWithPlugins = addGroup(OpenApiGroup).add(McpGroup).add(OnePasswordGroup);

// ---------------------------------------------------------------------------
// API Layer
// ---------------------------------------------------------------------------

const ApiLive = HttpApiBuilder.api(ExecutorApiWithPlugins).pipe(
  Layer.provide([
    ToolsHandlers,
    SourcesHandlers,
    SecretsHandlers,
    OpenApiHandlersLive,
    McpSourceHandlersLive,
    OnePasswordHandlersLive,
  ]),
  Layer.provide(ExecutorServiceLayer),
);

// ---------------------------------------------------------------------------
// Shared server — API + MCP from the same executor instance
// ---------------------------------------------------------------------------

export type ServerHandlers = {
  readonly api: {
    readonly handler: (request: Request) => Promise<Response>;
    readonly dispose: () => Promise<void>;
  };
  readonly mcp: McpRequestHandler;
};

export const createServerHandlers = async (): Promise<ServerHandlers> => {
  const executor = await getExecutor();

  const api = HttpApiBuilder.toWebHandler(
    HttpApiSwagger.layer().pipe(
      Layer.provideMerge(HttpApiBuilder.middlewareOpenApi()),
      Layer.provideMerge(HttpApiBuilder.middlewareCors()),
      Layer.provideMerge(ApiLive),
      Layer.provideMerge(HttpServer.layerContext),
    ),
    { middleware: HttpMiddleware.logger },
  );

  const mcp = createMcpRequestHandler({ executor });

  return { api, mcp };
};

// ---------------------------------------------------------------------------
// Backwards compat — standalone API handler (no MCP)
// ---------------------------------------------------------------------------

export const createApiHandler = () =>
  HttpApiBuilder.toWebHandler(
    HttpApiSwagger.layer().pipe(
      Layer.provideMerge(HttpApiBuilder.middlewareOpenApi()),
      Layer.provideMerge(HttpApiBuilder.middlewareCors()),
      Layer.provideMerge(ApiLive),
      Layer.provideMerge(HttpServer.layerContext),
    ),
    { middleware: HttpMiddleware.logger },
  );

export type ApiHandler = ReturnType<typeof createApiHandler>;

export { ExecutorServiceLayer } from "./services/executor";
