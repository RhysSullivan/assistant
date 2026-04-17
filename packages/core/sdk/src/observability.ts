// ---------------------------------------------------------------------------
// Runtime error-capture primitives.
//
// This is the *one* layer that knows how to translate the runtime cause
// of an unexpected failure into something the rest of the system speaks:
//
//   - `InternalError` is the public, opaque 500 surface. Schema is
//     deliberately narrow — `traceId` and nothing else — so no internal
//     cause / message / stack ever crosses the wire.
//   - `ErrorCapture` is a pluggable service the host wires up (Sentry in
//     the cloud Worker, console in the CLI, in-memory in tests). The
//     PluginCtx wrapper in `executor.ts` uses it to capture causes when
//     translating storage errors → InternalError.
//
// Distinct from `apps/cloud/src/services/telemetry.ts`, which is the
// Effect→OTEL bridge wiring spans to Axiom — that's "telemetry" in the
// tracing sense; this is "error capture" in the exception sense.
//
// Plugin SDK code never imports either of these. Plugins author normal
// Effect code; storage-layer failures get normalised at PluginCtx so
// extension methods only ever expose `Effect<X, InternalError | typed
// plugin errors>` to handlers.
// ---------------------------------------------------------------------------

import { Cause, Context, Effect, Layer, Schema } from "effect";
import { HttpApiSchema } from "@effect/platform";

/** Public 500 surface. Opaque by schema. */
export class InternalError extends Schema.TaggedError<InternalError>()(
  "InternalError",
  {
    /** Opaque correlation id for backend lookup (Sentry event id, log line, etc.). */
    traceId: Schema.String,
  },
  HttpApiSchema.annotations({ status: 500 }),
) {}

export interface ErrorCaptureShape {
  /**
   * Record an unexpected cause and return a correlation id the operator
   * can later look up. Implementations (Sentry, console, etc.) decide
   * how to persist it.
   */
  readonly captureException: (
    cause: Cause.Cause<unknown>,
  ) => Effect.Effect<string>;
}

export class ErrorCapture extends Context.Tag("@executor/sdk/ErrorCapture")<
  ErrorCapture,
  ErrorCaptureShape
>() {
  /** No-op — used in tests and any context that doesn't need real capture. */
  static readonly NoOp: Layer.Layer<ErrorCapture> = Layer.succeed(
    ErrorCapture,
    ErrorCapture.of({ captureException: () => Effect.succeed("") }),
  );
}
