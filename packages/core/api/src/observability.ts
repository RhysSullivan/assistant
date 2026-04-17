// ---------------------------------------------------------------------------
// HTTP-edge observability wiring.
//
// `ErrorCapture` and `InternalError` themselves live in `@executor/sdk`
// because the SDK's PluginCtx wrapper needs them to translate
// storage-layer failures before plugin code ever sees them. This file
// re-exports them and adds the one HttpApi-specific piece: the edge
// middleware, a defect safety net for anything that escaped the typed
// channels (sync throws, framework bugs, etc.).
//
// Usage at API construction:
//
//   const Api = MyApi.addError(InternalError)
//   const Live = HttpApiBuilder.api(Api).pipe(
//     Layer.provide(observabilityMiddleware(Api)),
//     Layer.provide(handlerLayers),
//   )
//
// The middleware only fires for *unhandled* causes; properly typed
// errors (UniqueViolationError lifted to a plugin's own typed error,
// the plugin's own 4xx errors, etc.) flow through their schemas as
// usual.
// ---------------------------------------------------------------------------

import { Effect, Option, type Layer } from "effect";
import {
  HttpApiBuilder,
  HttpServerResponse,
  type HttpApi,
  type HttpApiGroup,
} from "@effect/platform";

import { InternalError, ErrorCapture } from "@executor/sdk";

export { InternalError, ErrorCapture, type ErrorCaptureShape } from "@executor/sdk";

/**
 * Edge defect catchall. Builds an `HttpApiBuilder.middleware` layer
 * that wraps the HttpApp once. Captures any cause (defects, interrupts,
 * unmapped failures the framework couldn't encode) via `ErrorCapture` and
 * returns a typed `InternalError({ traceId })` body.
 *
 * `ErrorCapture` is OPTIONAL — if the host hasn't wired one up the
 * middleware still fires but the trace id will be empty. Hosts that
 * want capture (cloud Worker → Sentry) provide `ErrorCaptureLive` in
 * the layer composition.
 *
 * Should rarely fire when the SDK is well-typed — most failures get
 * normalised at the PluginCtx boundary or surface as plugin-typed 4xx
 * errors before they reach this layer.
 */
export const observabilityMiddleware = <
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(
  api: HttpApi.HttpApi<Id, Groups, E, R>,
): Layer.Layer<never> =>
  HttpApiBuilder.middleware(
    api,
    Effect.gen(function* () {
      const errorCapture = yield* Effect.serviceOption(ErrorCapture).pipe(
        Effect.map((opt) =>
          Option.isSome(opt)
            ? opt.value
            : ({ captureException: () => Effect.succeed("") } as const),
        ),
      );
      return (httpApp) =>
        Effect.catchAllCause(httpApp, (cause) =>
          Effect.gen(function* () {
            const traceId = yield* errorCapture.captureException(cause);
            return HttpServerResponse.unsafeJson(
              new InternalError({ traceId }),
              { status: 500 },
            );
          }),
        );
    }),
    { withContext: true },
  );
