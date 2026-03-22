import { createServer } from "node:http";

import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

export type RunningHttpApiTestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

export type RunningOpenApiTestServer = RunningHttpApiTestServer & {
  specUrl: string;
};

type TestApiLayer = Layer.Layer<any, any, never>;

type HttpApiTestServerOptions = {
  apiLayer: TestApiLayer;
  host?: string;
  openApiPath?: `/${string}`;
};

const createHttpApiServerLayer = (options: HttpApiTestServerOptions) => {
  const host = options.host ?? "127.0.0.1";
  const openApiPath = options.openApiPath;
  const apiLayerWithOpenApi =
    openApiPath === undefined
      ? options.apiLayer
      : Layer.mergeAll(
          options.apiLayer,
          HttpApiBuilder.middlewareOpenApi({ path: openApiPath }).pipe(
            Layer.provideMerge(options.apiLayer),
          ),
        );

  return HttpApiBuilder.serve().pipe(
    Layer.provide(apiLayerWithOpenApi),
    Layer.provideMerge(
      NodeHttpServer.layer(() => createServer(), {
        port: 0,
        host,
      }),
    ),
  );
};

export const startHttpApiTestServer = async (
  options: HttpApiTestServerOptions,
): Promise<RunningHttpApiTestServer> => {
  const scope = await Effect.runPromise(Scope.make());

  try {
    const context = await Effect.runPromise(
      Layer.buildWithScope(createHttpApiServerLayer(options), scope),
    );
    const server = Context.get(context, HttpServer.HttpServer);
    const baseUrl = HttpServer.formatAddress(server.address);

    return {
      baseUrl,
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    };
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
};

export const startOpenApiTestServer = async (
  options: HttpApiTestServerOptions,
): Promise<RunningOpenApiTestServer> => {
  const openApiPath = options.openApiPath ?? "/openapi.json";
  const server = await startHttpApiTestServer({
    ...options,
    openApiPath,
  });

  return {
    ...server,
    specUrl: `${server.baseUrl}${openApiPath}`,
  };
};

export const makeHttpApiTestServer = (
  options: HttpApiTestServerOptions,
): Effect.Effect<RunningHttpApiTestServer, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(() => startHttpApiTestServer(options)),
    (server) => Effect.promise(() => server.close()).pipe(Effect.orDie),
  );

export const makeOpenApiTestServer = (
  options: HttpApiTestServerOptions,
): Effect.Effect<RunningOpenApiTestServer, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(() => startOpenApiTestServer(options)),
    (server) => Effect.promise(() => server.close()).pipe(Effect.orDie),
  );
