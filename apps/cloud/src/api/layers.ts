import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpMiddleware, HttpRouter, HttpServer } from "effect/unstable/http";
import { Effect, Layer } from "effect";

import { CoreExecutorApi, observabilityMiddleware } from "@executor-js/api";
import { CoreHandlers } from "@executor-js/api/server";
import { OpenApiGroup, OpenApiHandlers } from "@executor-js/plugin-openapi/api";
import { McpGroup, McpHandlers } from "@executor-js/plugin-mcp/api";
import { GraphqlGroup, GraphqlHandlers } from "@executor-js/plugin-graphql/api";

import { OrgAuth } from "../auth/middleware";
import { OrgAuthLive, SessionAuthLive } from "../auth/middleware-live";
import { UserStoreService } from "../auth/context";
import {
  CloudAuthPublicHandlers,
  CloudSessionAuthHandlers,
  NonProtectedApi,
} from "../auth/handlers";
import { DbService } from "../services/db";
import { TelemetryLive } from "../services/telemetry";
import { OrgHttpApi } from "../org/compose";
import { OrgHandlers } from "../org/handlers";
import { ErrorCaptureLive } from "../observability";

import { CoreSharedServices } from "./core-shared-services";

export { CoreSharedServices };

export const ProtectedCloudApi = CoreExecutorApi.add(OpenApiGroup)
  .add(McpGroup)
  .add(GraphqlGroup)
  .middleware(OrgAuth);

const ObservabilityLive = observabilityMiddleware(ProtectedCloudApi);

const DbLive = DbService.Live;
const UserStoreLive = UserStoreService.Live.pipe(Layer.provide(DbLive));

export const SharedServices = Layer.mergeAll(
  DbLive,
  UserStoreLive,
  CoreSharedServices,
  HttpServer.layerServices,
  TelemetryLive,
);

export const RouterConfig = Layer.succeed(HttpRouter.RouterConfig)({ maxParamLength: 1000 });

export const ProtectedCloudApiLive = HttpApiBuilder.layer(ProtectedCloudApi).pipe(
  Layer.provide(
    Layer.mergeAll(
      CoreHandlers,
      OpenApiHandlers,
      McpHandlers,
      GraphqlHandlers,
      OrgAuthLive,
      ObservabilityLive,
    ),
  ),
  Layer.provide(ErrorCaptureLive),
);

const NonProtectedApiLive = HttpApiBuilder.layer(NonProtectedApi).pipe(
  Layer.provide(Layer.mergeAll(CloudAuthPublicHandlers, CloudSessionAuthHandlers)),
  Layer.provideMerge(SessionAuthLive),
);

const OrgApiLive = HttpApiBuilder.layer(OrgHttpApi).pipe(
  Layer.provide(OrgHandlers),
  Layer.provideMerge(OrgAuthLive),
);

const NonProtectedRequestLayer = NonProtectedApiLive.pipe(
  Layer.provideMerge(RouterConfig),
  Layer.provideMerge(HttpServer.layerServices),
);

const OrgRequestLayer = OrgApiLive.pipe(
  Layer.provideMerge(RouterConfig),
);

export const NonProtectedApiApp = Effect.flatMap(
  HttpRouter.toHttpEffect(NonProtectedRequestLayer as never),
  HttpMiddleware.logger,
).pipe(Effect.provide(SharedServices));

export const OrgApiApp = Effect.flatMap(
  HttpRouter.toHttpEffect(OrgRequestLayer as never),
  HttpMiddleware.logger,
).pipe(Effect.provide(SharedServices));
