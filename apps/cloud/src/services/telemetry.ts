// ---------------------------------------------------------------------------
// Effect → global OTEL bridge
// ---------------------------------------------------------------------------
// The global TracerProvider is owned by `@microlabs/otel-cf-workers` (see
// `server.ts`). This layer plugs Effect's tracer into that provider so every
// `Effect.withSpan(...)` becomes a real OTLP span exported to Axiom, with
// flushing handled reliably by the instrument() wrapper via ctx.waitUntil.
// ---------------------------------------------------------------------------

import { Resource, Tracer as OtelTracer } from "@effect/opentelemetry";
import { Layer } from "effect";

export const TelemetryLive: Layer.Layer<never> = OtelTracer.layerGlobal.pipe(
  Layer.provide(Resource.layer({ serviceName: "executor-cloud", serviceVersion: "1.0.0" })),
);
