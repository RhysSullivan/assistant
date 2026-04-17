// ---------------------------------------------------------------------------
// Storage-layer typed errors.
//
// Both are `Data.TaggedError` — runtime values, not wire schemas.
// Storage-core deliberately stays out of HTTP / serialisation / telemetry
// concerns. Upstream layers translate these into wire shapes (the SDK
// boundary maps `StorageError` → `InternalError(traceId)`; plugins
// `Effect.catchTag("UniqueViolationError")` and re-fail with their own
// schema'd error like `McpSourceAlreadyExistsError`).
//
// The `Data` choice (vs `Schema.TaggedError`) is enforcement: it's
// physically impossible to `addError(...)` these on an HttpApi group, so
// nobody can accidentally leak storage-layer details to clients by
// letting them serialize through.
// ---------------------------------------------------------------------------

import { Data } from "effect";

/**
 * Catch-all for non-recoverable backend failures (driver crash, network
 * gone, transaction abort the backend can't classify, etc.). The cause
 * travels as runtime data so the SDK boundary can capture it via
 * `ErrorCapture` before translating to the public `InternalError`.
 */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/**
 * Typed unique-constraint violation. Plugins are expected to
 * `Effect.catchTag` this and translate to their own user-facing error.
 * Carries an optional `model` so a plugin doing a batch insert across
 * tables can disambiguate; everything else (constraint name, raw
 * driver message) stays internal because plugin code rarely needs it
 * and surfacing it leaks backend specifics.
 */
export class UniqueViolationError extends Data.TaggedError(
  "UniqueViolationError",
)<{
  readonly model?: string;
}> {}
