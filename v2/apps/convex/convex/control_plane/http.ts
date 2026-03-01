import {
  ControlPlaneService,
  controlPlaneOpenApiSpec,
  makeControlPlaneWebHandler,
} from "@executor-v2/control-plane";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { httpAction, type ActionCtx } from "../_generated/server";
import {
  controlPlaneErrorResponse,
  normalizeControlPlaneErrorResponse,
  toSourceStoreError,
} from "./errors";
import { makeConvexControlPlaneService } from "./service";

const isOpenApiRequest = (request: Request): boolean =>
  new URL(request.url).pathname === "/v1/openapi.json";

const handleControlPlaneRequest = (
  ctx: ActionCtx,
  request: Request,
): Effect.Effect<Response, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      if (isOpenApiRequest(request)) {
        return Response.json(controlPlaneOpenApiSpec, { status: 200 });
      }

      const webHandler = makeControlPlaneWebHandler(
        Layer.succeed(ControlPlaneService, makeConvexControlPlaneService(ctx)),
      );

      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => webHandler.dispose(),
          catch: (cause) => toSourceStoreError("controlPlane.dispose", cause),
        }).pipe(
          Effect.asVoid,
          Effect.catchAll(() => Effect.void),
        ),
      );

      const response = yield* Effect.tryPromise({
        try: () => webHandler.handler(request),
        catch: (cause) => toSourceStoreError("controlPlane.http", cause),
      });

      return normalizeControlPlaneErrorResponse(response);
    }),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        controlPlaneErrorResponse(
          500,
          "Control plane request failed",
          error.details,
        ),
      ),
    ),
  );

export const controlPlaneHttpHandler = httpAction((ctx, request) =>
  Effect.runPromise(handleControlPlaneRequest(ctx, request)),
);
