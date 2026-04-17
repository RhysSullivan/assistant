# Error handling — model + plumbing

## Principle

Errors are typed values that propagate through the call graph carrying
their full causal structure. **Exactly one layer at the edge** consumes
them and maps them to a public response. Plugin code never imports
Sentry, never calls `captureException`, never wraps handlers with
`sanitize*` helpers.

Two error categories:

- **Surfaceable**: typed Schema errors with a user-actionable message
  (`McpOAuthError`, `OpenApiParseError`, …). Carry through to the
  response with their own status (4xx) and message body. Not captured
  to any external sink — they're normal business outcomes.
- **Internal**: truly unexpected (storage failure, third-party returned
  garbage, sync throw inside a handler). Captured via `ErrorCapture` at
  the SDK boundary, then propagated as the shared
  `InternalError({ traceId })` schema — opaque to clients, fully
  detailed in Sentry. One shape, one trace id, one place to look up
  the cause.

## Plumbing

### Storage layer (`@executor/storage-core`)

Emits two `Data.TaggedError` classes and nothing else observability-related:

- `StorageError({ message, cause })` — the catch-all for non-recoverable
  backend failures. The `cause` travels as runtime data so upstream can
  capture it, but it's never serialised to the wire.
- `UniqueViolationError({ model? })` — typed 4xx-shaped failure plugins
  want to react to (e.g. "source already exists").

Both are `Data.TaggedError`, not `Schema.TaggedError` — you physically
can't `addError(...)` them on an HttpApi group, which enforces "these
are internal types, not wire shapes".

`DBAdapter` / `CustomAdapter` / `TypedAdapter` declare
`Effect<X, StorageFailure>` where `StorageFailure = StorageError |
UniqueViolationError`. No `Error`, no `Telemetry` in R.

Storage-core has zero observability awareness — it just emits typed
values and lets consumers decide what to do with them.

### SDK boundary (`@executor/sdk/observability`)

Defines:

- `InternalError({ traceId })` — the public opaque 500 schema, with an
  `HttpApiSchema.annotations({ status: 500 })` annotation so the HTTP
  framework encodes it correctly.
- `ErrorCapture` — tagged Effect service for recording unexpected
  causes. Shape:

  ```ts
  interface ErrorCaptureShape {
    readonly captureException: (cause: Cause<unknown>) => Effect<string>
  }
  ```

- `ErrorCapture.NoOp` — a Layer providing a capture implementation that
  just returns the empty string. Available for tests or any consumer
  that doesn't want external capture.

### Executor (`@executor/sdk/executor.ts`)

At `createExecutor` construction time:

1. Looks up `ErrorCapture` via `Effect.serviceOption` — **optional
   service**. If the host provided one, use it; otherwise default to a
   no-op. `createExecutor`'s effect therefore has `R = never`; hosts
   who want capture provide `ErrorCapture` via Layer, hosts who don't
   care do nothing.
2. Builds `liftStorage` — the one translator that converts
   `StorageError` from the storage layer into captured
   `InternalError({ traceId })`. Catches `StorageError` only;
   `UniqueViolationError` and plugin typed errors pass through
   unchanged.
3. Wraps the underlying adapter (`wrapAdapterForPlugin`) so every
   method routes through `liftStorage`. The plugin-facing adapter
   never emits `StorageError` at runtime.
4. Wraps every `PluginCtx` surface (`ctx.storage`, `ctx.core.*`,
   `ctx.secrets.*`, `ctx.transaction`) through `liftStorage`. Plugin
   code therefore sees `Effect<X, InternalError | UniqueViolationError>`
   everywhere.
5. Wraps the executor's own public methods (`tools.list`,
   `sources.refresh`, `secrets.get`, etc.) through `liftStorage` too —
   host code sees `Effect<X, InternalError | UniqueViolationError>`.

### Plugin SDK

Plugin authors write normal Effect code. They never see raw
`StorageError`, never provide `ErrorCapture`, never call Sentry. Their
extension method signatures typically look like:

```ts
Effect.Effect<X, MyPluginTypedError | InternalError, never>
```

Where `MyPluginTypedError` is the union of their own
`Schema.TaggedError` classes (with `HttpApiSchema.annotations({ status: 4xx })`).
Typed `UniqueViolationError` can be caught with `Effect.catchTag` and
translated to a plugin-specific error (`McpSourceAlreadyExistsError`,
etc.) before surfacing.

### API groups

Each group declares its typed errors once at the group level:

```ts
class McpGroup extends HttpApiGroup.make("mcp")
  .add(endpoint1)
  .add(endpoint2)
  // …
  .addError(InternalError)
  .addError(McpOAuthError)
  .addError(McpConnectionError)
  // …
{}
```

No per-endpoint `addError`. The framework encodes each tagged error by
its annotated status.

### Edge middleware (`@executor/api/observabilityMiddleware`)

An `HttpApiBuilder.middleware` layer, one per API. Wraps the entire
HttpApp once. Catches any cause that escaped the typed channels
(defects, interrupts, framework bugs) via `ErrorCapture` and returns a
typed `InternalError({ traceId })` body. `ErrorCapture` is again
optional here — no-op fallback if nothing's provided.

Should rarely fire when the SDK is well-typed — most failures get
normalised at the PluginCtx boundary or surface as plugin-typed 4xx
errors before they reach this layer.

### Hosts

- **Cloud Worker** (`apps/cloud/src/observability.ts`) — provides
  `ErrorCaptureLive`, a Sentry-backed implementation. Wired into
  `createScopedExecutor` and into the protected API layer.
  (Distinct from `apps/cloud/src/services/telemetry.ts`, which is the
  OTEL→Axiom span bridge — "telemetry" in the tracing sense.)
- **CLI** (`apps/local/src/server/executor.ts`) — doesn't wire
  anything. Storage failures still surface as
  `InternalError(traceId="")` in the typed channel, they just aren't
  recorded externally. Drop-in an `ErrorCapture` layer when we want a
  console or file sink.
- **Tests / promise SDK / examples** — same: nothing wired, no-op
  default.

### Anti-patterns

- `Effect.orDie` at handler boundaries — silently turns recoverable
  failures into 500s with no telemetry.
- Per-plugin `*InternalError` types — clients can't tell which plugin
  emitted a 500 anyway. Use the shared `InternalError`.
- `sanitize*` helpers in handler files that `catchAllCause` + map to a
  generic 500 — same swallowing problem in disguise.
- Plugin SDK code importing `Sentry.captureException` directly —
  capture is at the PluginCtx boundary (SDK) or the edge middleware
  safety net.
- `ErrorCapture` being required by `createExecutor` — we deliberately
  made it optional so tests and lightweight hosts don't have to wire
  the service.
