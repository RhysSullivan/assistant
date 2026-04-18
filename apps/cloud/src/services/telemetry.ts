// ---------------------------------------------------------------------------
// Effect → OTEL → Axiom bridge
// ---------------------------------------------------------------------------
//
// Two callers, two setups:
//
// - `TelemetryLive` (fetch path): reads the global `TracerProvider` that
//   `@microlabs/otel-cf-workers`' `instrument(...)` installs in `server.ts`.
//   Flushing is handled by `instrument()` via `ctx.waitUntil` at request end.
//
// - `DoTelemetryLive` (Durable Object path): provisions its own
//   `WebSdk`-backed tracer via `Effect`. The DO runs in a separate isolate
//   and we deliberately avoid `instrumentDO` (it wraps DO methods in a way
//   that breaks `this` binding on `WorkerTransport`'s stream primitives —
//   every MCP request 500s with "Illegal invocation"). The DO uses a
//   `SimpleSpanProcessor` so spans export immediately; there's no
//   `ctx.waitUntil` to rely on for batching.
//
//   Reads the Axiom token/URL from `cloudflare:workers` `env` rather than
//   `process.env` (via `./env`). Under nodejs_compat, `process.env` is
//   populated for the edge fetch isolate at module load but can land
//   empty in the DO isolate when the module evaluates before the first
//   request — which silently demotes this layer to `Layer.empty` and
//   drops every DO span. `env` from `cloudflare:workers` is always
//   populated for the current isolate's bindings.
// ---------------------------------------------------------------------------

// Subpath imports — the barrel `@effect/opentelemetry` re-exports `NodeSdk`,
// which eagerly imports `@opentelemetry/sdk-trace-node` and its
// `context-async-hooks` dep. Under vitest-pool-workers that crashes module
// load (no `async_hooks` in workerd). Production bundles tree-shake the
// unused NodeSdk; vitest does not.
import { env } from "cloudflare:workers";
import * as Resource from "@effect/opentelemetry/Resource";
import * as OtelTracer from "@effect/opentelemetry/Tracer";
import * as WebSdk from "@effect/opentelemetry/WebSdk";
// Force the browser platform entry — the package's conditional export would
// otherwise resolve to the Node build, which uses `https.request` / `node:http`.
// Under workerd + unenv's nodejs_compat, `https.request` isn't implemented
// (surfaces as `[unenv] https.request is not implemented yet!` at export
// time) and every DO span fails to ship. The browser build uses `fetch()`,
// which workerd does support.
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http/build/esm/platform/browser/index.js";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Effect, Layer } from "effect";

export const TelemetryLive: Layer.Layer<never> = OtelTracer.layerGlobal.pipe(
  Layer.provide(Resource.layer({ serviceName: "executor-cloud", serviceVersion: "1.0.0" })),
);

type AxiomEnv = {
  readonly AXIOM_TOKEN?: string;
  readonly AXIOM_DATASET?: string;
  readonly AXIOM_TRACES_URL?: string;
};

// Lazy: `env.AXIOM_TOKEN` is read at layer-build time (when `Effect.provide`
// kicks off a handleRequest/alarm/init), not at module load. Reading at
// module load in the DO isolate landed empty in prod even when the secret
// was configured, which silently demoted DoTelemetryLive to Layer.empty
// and dropped every DO span.
export const DoTelemetryLive: Layer.Layer<never> = Layer.unwrapEffect(
  Effect.sync(() => {
    const axiomEnv = env as AxiomEnv;
    if (!axiomEnv.AXIOM_TOKEN) return Layer.empty;
    const exporter = new OTLPTraceExporter({
      url: axiomEnv.AXIOM_TRACES_URL ?? "https://api.axiom.co/v1/traces",
      headers: {
        Authorization: `Bearer ${axiomEnv.AXIOM_TOKEN}`,
        "X-Axiom-Dataset": axiomEnv.AXIOM_DATASET ?? "executor-cloud",
      },
    });
    return WebSdk.layer(() => ({
      resource: { serviceName: "executor-cloud", serviceVersion: "1.0.0" },
      spanProcessor: new SimpleSpanProcessor(exporter),
    }));
  }),
);
