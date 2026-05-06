import { makeMemoryAdapter } from "@executor-js/storage-core/testing/memory";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Context, Data, Effect, Layer, Predicate, Scope as EffectScope } from "effect";
import {
  HttpClient,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { makeInMemoryBlobStore } from "./blob";
import type { ExecutorConfig } from "./executor";
import { collectSchemas } from "./executor";
import { ScopeId } from "./ids";
import { definePlugin, type AnyPlugin } from "./plugin";
import { Scope } from "./scope";
import type { SecretProvider } from "./secrets";

// ---------------------------------------------------------------------------
// makeTestConfig — build an ExecutorConfig backed by in-memory adapter +
// blob store. For unit tests, plugin authors validating their plugin,
// REPL experimentation. No persistence.
//
// Defaults to a single-element scope stack ("test-scope") — tests that
// need multi-scope behavior can pass `scopes` explicitly.
// ---------------------------------------------------------------------------

export const makeTestConfig = <const TPlugins extends readonly AnyPlugin[] = []>(options?: {
  readonly scopeName?: string;
  readonly scopes?: readonly Scope[];
  readonly plugins?: TPlugins;
}): ExecutorConfig<TPlugins> => {
  const scopes = options?.scopes ?? [
    new Scope({
      id: ScopeId.make("test-scope"),
      name: options?.scopeName ?? "test",
      createdAt: new Date(),
    }),
  ];

  const schema = collectSchemas(options?.plugins ?? []);

  return {
    scopes,
    adapter: makeMemoryAdapter({ schema }),
    blobs: makeInMemoryBlobStore(),
    plugins: options?.plugins,
    // Tests default to auto-accepting elicitation prompts. Override via
    // a wrapping spread if a test exercises a real handler:
    //   { ...makeTestConfig(...), onElicitation: customHandler }
    onElicitation: "accept-all",
  };
};

export const memorySecretsPlugin = definePlugin(() => {
  const store = new Map<string, string>();

  const provider: SecretProvider = {
    key: "memory",
    writable: true,
    get: (id, scope) => Effect.sync(() => store.get(`${scope}\u0000${id}`) ?? null),
    set: (id, value, scope) =>
      Effect.sync(() => {
        store.set(`${scope}\u0000${id}`, value);
      }),
    delete: (id, scope) => Effect.sync(() => store.delete(`${scope}\u0000${id}`)),
    list: () =>
      Effect.sync(() =>
        Array.from(store.keys()).map((key) => {
          const name = key.split("\u0000", 2)[1] ?? key;
          return { id: name, name };
        }),
      ),
  };

  return {
    id: "memory-secrets" as const,
    storage: () => ({}),
    secretProviders: [provider],
  };
});

export class TestHttpServerAddressError extends Data.TaggedError("TestHttpServerAddressError")<{
  readonly address: unknown;
}> {}

export class TestHttpServerServeError extends Data.TaggedError("TestHttpServerServeError")<{
  readonly cause: unknown;
}> {}

export interface TestHttpServerShape {
  readonly baseUrl: string;
  readonly httpClientLayer: Layer.Layer<HttpClient.HttpClient>;
  readonly url: (path?: string) => string;
}

export type TestHttpRoute = HttpRouter.Route<any, any>;
export type TestHttpRequest = HttpServerRequest.HttpServerRequest;
export type TestHttpResponse = HttpServerResponse.HttpServerResponse;

export const testHttpRoute = HttpRouter.route;

export const serveTestHttpRoutes = (
  routes: readonly TestHttpRoute[],
): Effect.Effect<
  TestHttpServerShape,
  TestHttpServerAddressError | TestHttpServerServeError,
  EffectScope.Scope
> =>
  makeTestHttpServer(
    HttpRouter.serve(HttpRouter.addAll(routes), {
      disableListenLog: true,
      disableLogger: true,
    }),
  );

export const serveTestHttpApp = (
  handler: (request: TestHttpRequest) => Effect.Effect<TestHttpResponse>,
): Effect.Effect<
  TestHttpServerShape,
  TestHttpServerAddressError | TestHttpServerServeError,
  EffectScope.Scope
> =>
  makeTestHttpServer(
    HttpServer.serve(HttpServerRequest.HttpServerRequest.asEffect().pipe(Effect.flatMap(handler))),
  );

const makeTestHttpServer = (
  serverLayer: Layer.Layer<never, never, HttpServer.HttpServer>,
): Effect.Effect<
  TestHttpServerShape,
  TestHttpServerAddressError | TestHttpServerServeError,
  EffectScope.Scope
> =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      Layer.fresh(serverLayer.pipe(Layer.provideMerge(NodeHttpServer.layerTest))),
    ).pipe(Effect.mapError((cause) => new TestHttpServerServeError({ cause })));
    const server = Context.get(context, HttpServer.HttpServer);
    const address = server.address;
    if (!Predicate.isTagged(address, "TcpAddress")) {
      return yield* new TestHttpServerAddressError({ address });
    }
    const client = Context.get(context, HttpClient.HttpClient);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return {
      baseUrl,
      httpClientLayer: Layer.succeed(HttpClient.HttpClient, client),
      url: (path = "") => new URL(path, baseUrl).toString(),
    };
  });
