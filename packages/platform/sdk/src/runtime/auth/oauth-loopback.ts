import {
  createServer,
} from "node:http";

import * as Effect from "effect/Effect";

const DEFAULT_LOOPBACK_TIMEOUT_MS = 10 * 60_000;

export type OauthLoopbackRedirectServer = {
  redirectUri: string;
  close: Effect.Effect<void, Error, never>;
};

const closeServer = (
  server: ReturnType<typeof createServer>,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

export const startOauthLoopbackRedirectServer = (input: {
  completionUrl: string;
  publicHost?: "localhost" | "127.0.0.1";
  listenHost?: "127.0.0.1";
  timeoutMs?: number;
}): Effect.Effect<OauthLoopbackRedirectServer, Error, never> =>
  Effect.tryPromise({
    try: () =>
      new Promise<OauthLoopbackRedirectServer>((resolve, reject) => {
    const publicHost = input.publicHost ?? "127.0.0.1";
    const listenHost = input.listenHost ?? "127.0.0.1";
    const completionUrl = new URL(input.completionUrl);
    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(
          request.url ?? "/",
          `http://${publicHost}`,
        );
        const redirectUrl = new URL(completionUrl.toString());

        for (const [key, value] of requestUrl.searchParams.entries()) {
          redirectUrl.searchParams.set(key, value);
        }

        response.statusCode = 302;
        response.setHeader("cache-control", "no-store");
        response.setHeader("location", redirectUrl.toString());
        response.end();
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end(`OAuth redirect failed: ${error.message}`);
      } finally {
      void closeServer(server).catch(() => {});
      }
    });

    let timeout: NodeJS.Timeout | null = null;
    const cleanup = (): Promise<void> => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      return closeServer(server).catch(() => undefined);
    };

    server.once("error", (cause) => {
      reject(
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    });

    server.listen(0, listenHost, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve OAuth loopback port"));
        return;
      }

      timeout = setTimeout(() => {
        void cleanup();
      }, input.timeoutMs ?? DEFAULT_LOOPBACK_TIMEOUT_MS);
      if (typeof timeout.unref === "function") {
        timeout.unref();
      }

      resolve({
        redirectUri: `http://${publicHost}:${address.port}`,
        close: Effect.tryPromise({
          try: cleanup,
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        }),
      });
    });
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
