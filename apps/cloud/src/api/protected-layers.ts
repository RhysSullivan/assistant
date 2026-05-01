// Protected-side API wiring. Kept separate from `./layers.ts` so tests
// can import the protected API + shared services without dragging in
// non-protected/org handlers (which transitively import
// `@tanstack/react-start`, unresolvable in the Workers test runtime).

import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { Layer } from "effect";

import {
  CoreExecutorApi,
  observabilityMiddleware,
} from "@executor-js/api";
import { CoreHandlers } from "@executor-js/api/server";
import { OpenApiGroup, OpenApiHandlers } from "@executor-js/plugin-openapi/api";
import { McpGroup, McpHandlers } from "@executor-js/plugin-mcp/api";
import { GraphqlGroup, GraphqlHandlers } from "@executor-js/plugin-graphql/api";

import { OrgAuth } from "../auth/middleware";
import { OrgAuthLive } from "../auth/middleware-live";
import { UserStoreService } from "../auth/context";
import { WorkOSAuth } from "../auth/workos";
import { AutumnService } from "../services/autumn";
import { DbService } from "../services/db";
import { ErrorCaptureLive } from "../observability";

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
  WorkOSAuth.Default,
  AutumnService.Default,
  HttpServer.layerServices,
);

export const RouterConfig = Layer.succeed(HttpRouter.RouterConfig)({ maxParamLength: 1000 });

// Every handler the ProtectedCloudApi routes to, minus auth. The test
// harness builds its own api-live by merging this with a fake OrgAuth
// layer; prod merges it with OrgAuthLive below.
export const ProtectedCloudApiHandlers = Layer.mergeAll(
  CoreHandlers,
  OpenApiHandlers,
  McpHandlers,
  GraphqlHandlers,
);

// `ErrorCaptureLive` is provided above the handler + middleware layers
// so the `withCapture` translation path (typed-channel `StorageError →
// InternalError(traceId)`) AND the observability middleware's defect
// catchall both see the same Sentry-backed implementation.
export const ProtectedCloudApiLive = HttpApiBuilder.layer(ProtectedCloudApi).pipe(
  Layer.provide(
    Layer.mergeAll(ProtectedCloudApiHandlers, OrgAuthLive, ObservabilityLive),
  ),
  Layer.provide(ErrorCaptureLive),
);
