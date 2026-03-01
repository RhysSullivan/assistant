import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { BunHttpServer, BunHttpServerRequest } from "@effect/platform-bun";
import {
  ControlPlaneService,
  controlPlaneOpenApiSpec,
  makeControlPlaneWebHandler,
} from "@executor-v2/control-plane";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PmConfig } from "./config";
import { PmMcpHandler } from "./mcp-handler";
import { handleToolCallHttp } from "./tool-call-handler";

const fromWebHandler = (handler: (request: Request) => Promise<Response>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const response = yield* Effect.promise(() =>
      handler(BunHttpServerRequest.toRequest(request))
    );

    return HttpServerResponse.raw(response);
  });

export const startPmHttpServer = Effect.fn("@executor-v2/app-pm/http.start")(function* () {
  const { port } = yield* PmConfig;
  const { handleMcp } = yield* PmMcpHandler;
  const controlPlaneService = yield* ControlPlaneService;
  const controlPlaneWebHandler = yield* Effect.sync(() =>
    makeControlPlaneWebHandler(
      Layer.succeed(ControlPlaneService, controlPlaneService),
    ),
  );

  yield* Effect.addFinalizer(() =>
    Effect.promise(() => controlPlaneWebHandler.dispose()),
  );

  const httpLive = HttpRouter.empty.pipe(
    HttpRouter.get("/healthz", HttpServerResponse.json({ ok: true, service: "pm" })),
    HttpRouter.get("/v1/mcp", fromWebHandler(handleMcp)),
    HttpRouter.post("/v1/mcp", fromWebHandler(handleMcp)),
    HttpRouter.del("/v1/mcp", fromWebHandler(handleMcp)),
    HttpRouter.post("/v1/runtime/tool-call", handleToolCallHttp),
    HttpRouter.get("/v1/workspaces/:workspaceId/sources", fromWebHandler(controlPlaneWebHandler.handler)),
    HttpRouter.post("/v1/workspaces/:workspaceId/sources", fromWebHandler(controlPlaneWebHandler.handler)),
    HttpRouter.del(
      "/v1/workspaces/:workspaceId/sources/:sourceId",
      fromWebHandler(controlPlaneWebHandler.handler),
    ),
    HttpRouter.get(
      "/v1/openapi.json",
      HttpServerResponse.unsafeJson(controlPlaneOpenApiSpec),
    ),
    HttpServer.serve(),
    HttpServer.withLogAddress,
    Layer.provide(BunHttpServer.layer({ port })),
  );

  return yield* Layer.launch(httpLive);
});
