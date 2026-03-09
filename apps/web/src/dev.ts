/**
 * Dev entry point for @hono/vite-dev-server.
 *
 * Exports `{ fetch }` so Vite can forward API requests to the executor
 * control-plane handler. Everything else (frontend assets, HMR) is
 * handled by Vite itself.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Runtime from "effect/Runtime";
import * as Scope from "effect/Scope";
import { createLocalExecutorRequestHandler } from "@executor-v3/server";

const MAX_LOGGED_ERROR_BODY_LENGTH = 4_000;

const truncateForLog = (value: string): string =>
  value.length > MAX_LOGGED_ERROR_BODY_LENGTH
    ? `${value.slice(0, MAX_LOGGED_ERROR_BODY_LENGTH)}... [truncated]`
    : value;

/**
 * Extract a detailed, human-readable description from an error.
 *
 * When Effect rejects via `runPromise`, the thrown value is a
 * `FiberFailure` wrapping a `Cause`. `Cause.pretty` renders the full
 * failure tree (defects, interrupts, tagged errors, etc.) rather than the
 * opaque fallback message ("An error has occurred").
 */
const formatErrorForLog = (error: unknown): string => {
  if (Runtime.isFiberFailure(error)) {
    const cause = error[Runtime.FiberFailureCauseId];
    return Cause.pretty(cause);
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
};

// Create a long-lived scope that stays open for the lifetime of the process.
const handlerPromise = (async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const handler = yield* createLocalExecutorRequestHandler().pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      return handler;
    }),
  );

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  // Log the full Cause tree — this captures typed errors, defects (uncaught
  // throws), and interrupts with their original stack traces.
  console.error(
    "[executor dev api] failed to initialize request handler\n\n" +
      Cause.pretty(exit.cause),
  );

  // Re-throw so every subsequent request sees the init failure.
  throw Cause.squash(exit.cause);
})();

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);

    try {
      const handler = await handlerPromise;
      handler.setBaseUrl(url.origin);

      const response = await handler.handleApiRequest(request);

      if (url.pathname.startsWith("/v1/") && response.status >= 500) {
        let bodyText = "<unavailable>";
        try {
          bodyText = truncateForLog(await response.clone().text());
        } catch {}

        console.error("[executor dev api] request failed", {
          method: request.method,
          url: url.toString(),
          status: response.status,
          contentType: response.headers.get("content-type"),
          body: bodyText,
        });
      }

      return response;
    } catch (error) {
      console.error("[executor dev api] unhandled request error", {
        method: request.method,
        url: url.toString(),
        error: formatErrorForLog(error),
      });
      throw error;
    }
  },
};
