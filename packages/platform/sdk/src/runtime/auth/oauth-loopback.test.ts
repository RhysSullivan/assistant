import {
  createServer,
} from "node:http";

import {
  describe,
  expect,
  it,
} from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  startOauthLoopbackRedirectServer,
} from "./oauth-loopback";

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const makeCompletionServer = Effect.acquireRelease(
  Effect.tryPromise({
    try: () =>
      new Promise<{
        completionUrl: string;
        requests: string[];
        server: ReturnType<typeof createServer>;
      }>((resolve, reject) => {
        const requests: string[] = [];
        const server = createServer((request, response) => {
          requests.push(request.url ?? "/");
          response.statusCode = 200;
          response.end("ok");
        });

        server.listen(0, "127.0.0.1", (error?: Error) => {
          if (error) {
            reject(error);
            return;
          }

          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Failed to resolve completion server address"));
            return;
          }

          resolve({
            completionUrl: `http://127.0.0.1:${address.port}/oauth/complete?sessionId=test-session`,
            requests,
            server,
          });
        });
      }),
    catch: toError,
  }),
  ({ server }) =>
    Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
      catch: toError,
    }),
);

const withCompletionServer = <T>(
  handler: (input: {
    completionUrl: string;
    requests: string[];
  }) => Effect.Effect<T, Error, never>,
) => Effect.flatMap(makeCompletionServer, handler);

describe("oauth-loopback", () => {
  it.scoped(
    "redirects loopback callbacks to the app completion URL with query params intact",
    () =>
      withCompletionServer(({ completionUrl, requests }) =>
        Effect.gen(function* () {
          const receiver = yield* Effect.acquireRelease(
            startOauthLoopbackRedirectServer({
              completionUrl,
            }),
            (server) => server.close,
          );

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(
                `${receiver.redirectUri}?state=oauth-state&code=oauth-code`,
                {
                  redirect: "follow",
                  signal: AbortSignal.timeout(10_000),
                },
              ),
            catch: toError,
          });

          expect(response.ok).toBe(true);
          expect(requests).toEqual([
            "/oauth/complete?sessionId=test-session&state=oauth-state&code=oauth-code",
          ]);
        }),
      ),
  );
});
