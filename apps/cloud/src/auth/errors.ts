import { Data, Effect, Schema } from "effect";

export class UserStoreError extends Schema.TaggedErrorClass<UserStoreError>()(
  "UserStoreError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

export class WorkOSError extends Schema.TaggedErrorClass<WorkOSError>()(
  "WorkOSError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

/**
 * Private wrapper used by service adapters that lift Promise APIs into
 * Effect. `withServiceLogging` immediately remaps these into a public-facing
 * tagged error, so callers never observe this tag directly — its only job is
 * to keep the internal failure channel typed instead of `unknown` / `Error`.
 */
export class ServiceAdapterError extends Data.TaggedError("ServiceAdapterError")<{
  readonly cause: unknown;
}> {}

/** Lift a Promise-returning function into Effect with a typed failure channel. */
export const tryPromiseService = <A>(fn: () => Promise<A>): Effect.Effect<A, ServiceAdapterError> =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new ServiceAdapterError({ cause }),
  });

/**
 * Service-boundary error wrapper. Logs the full Cause chain (drizzle
 * query/params, pg error codes, nested Error.cause, etc.) via Effect's
 * structured logger, then maps to a tagged error so the HTTP wire
 * response contains only safe fields.
 *
 * Use this whenever a Promise-based API gets lifted into an Effect and
 * its failure needs both debuggable server-side logging and a safe
 * public shape.
 */
export const withServiceLogging = <A, E, R>(
  name: string,
  publicError: (message: string) => E,
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.tapCause((cause) => Effect.logError(`${name} failed`, cause)),
    Effect.mapError((error) => {
      const message =
        error instanceof ServiceAdapterError
          ? error.cause instanceof Error
            ? error.cause.message
            : String(error.cause)
          : error instanceof Error
            ? error.message
            : String(error);
      return publicError(message);
    }),
    Effect.withSpan(name),
  ) as Effect.Effect<A, E, R>;
