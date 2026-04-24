import * as Cause from "effect/Cause";
import * as Data from "effect/Data";

export class KernelCoreEffectError extends Data.TaggedError("KernelCoreEffectError")<{
  readonly module: string;
  readonly message: string;
}> {}

export const kernelCoreEffectError = (module: string, message: string) =>
  new KernelCoreEffectError({ module, message });

/**
 * Default failure type for any `CodeExecutor.execute` implementation —
 * surfaces sandbox-level defects (isolate crash, module load failure,
 * worker loader error) as a typed error so callers can handle them
 * structurally instead of untyped `unknown`. Runtimes that want a
 * narrower error shape can define their own `Data.TaggedError` subclass
 * and parameterize `CodeExecutor<MyError>`.
 */
export class CodeExecutionError extends Data.TaggedError("CodeExecutionError")<{
  readonly runtime: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Extract a human-readable message from an unknown error value.
 * Handles Error instances, strings, objects with `.message`, and
 * arbitrary values via JSON.stringify / String fallback.
 */
export const formatUnknownMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    const message = cause.message.trim();
    return message.length > 0 ? message : cause.name;
  }

  if (typeof cause === "string") {
    return cause;
  }

  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    const message = cause.message.trim();
    if (message.length > 0) return message;
  }

  if (typeof cause === "object" && cause !== null) {
    try {
      return JSON.stringify(cause);
    } catch {
      return String(cause);
    }
  }

  return String(cause);
};

/**
 * Squash an Effect `Cause` and extract a readable message.
 */
export const formatCauseMessage = (cause: Cause.Cause<unknown>): string =>
  formatUnknownMessage(Cause.squash(cause));
