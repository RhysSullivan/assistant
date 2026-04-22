// ---------------------------------------------------------------------------
// Provisioning app wiring.
//
// This is the standalone HttpApp exposed under `/provision/*` (prefix added
// by the top-level router — see apps/cloud/src/api/router.ts). Keeping it in
// its own HttpApi (not merged into `ProtectedCloudApi`) means:
//   • the bearer middleware doesn't have to co-exist with the session-cookie
//     `OrgAuth` middleware on the same group,
//   • endpoints aren't scoped under `/scopes/:scopeId/...`, matching the
//     /api/v1/provision URL shape,
//   • the emitted OpenAPI doc at `/docs` only advertises these routes when
//     an operator hits them with the bearer.
// ---------------------------------------------------------------------------

import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
} from "@effect/platform";
import { Effect, Layer } from "effect";

import { UserStoreService } from "../../auth/context";
import { DbService } from "../../services/db";
import { CoreSharedServices } from "../core-shared-services";
import { ProvisionHttpApi } from "./api";
import { ProvisionHandlers, ProvisionVaultOptionsLive } from "./handlers";
import { ProvisionAuth, ProvisionAuthLive } from "./middleware";

export const buildProvisionApp = (
  authLayer: Layer.Layer<ProvisionAuth, never, never>,
) => {
  const DbLive = DbService.Live;
  const UserStoreLive = UserStoreService.Live.pipe(Layer.provide(DbLive));

  const SharedServices = Layer.mergeAll(
    DbLive,
    UserStoreLive,
    CoreSharedServices,
    ProvisionVaultOptionsLive,
    HttpServer.layerContext,
  );

  const RouterConfig = HttpRouter.setRouterConfig({ maxParamLength: 1000 });

  const ApiLive = HttpApiBuilder.api(ProvisionHttpApi).pipe(
    Layer.provide(ProvisionHandlers),
    Layer.provideMerge(authLayer),
  );

  const RequestLayer = ApiLive.pipe(
    Layer.provideMerge(RouterConfig),
    Layer.provideMerge(HttpServer.layerContext),
    Layer.provideMerge(HttpApiBuilder.Router.Live),
    Layer.provideMerge(HttpApiBuilder.Middleware.layer),
  );

  return Effect.flatMap(
    HttpApiBuilder.httpApp.pipe(
      Effect.provide(
        HttpApiSwagger.layer({ path: "/docs" }).pipe(
          Layer.provideMerge(HttpApiBuilder.middlewareOpenApi()),
          Layer.provideMerge(RequestLayer),
        ),
      ),
    ),
    HttpMiddleware.logger,
  ).pipe(Effect.provide(SharedServices));
};

/** Production app: reads the shared bearer out of `env`. */
export const ProvisionApiApp = buildProvisionApp(ProvisionAuthLive);
