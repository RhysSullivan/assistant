import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { Context, Data, Effect, Layer, Ref, Schema as EffectSchema, Scope } from "effect";
import { GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } from "graphql";
import { createYoga, type GraphQLParams, type YogaInitialContext } from "graphql-yoga";

const GraphqlRequestPayload = EffectSchema.Struct({
  query: EffectSchema.optional(EffectSchema.String),
  variables: EffectSchema.optional(EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown)),
  operationName: EffectSchema.optional(EffectSchema.NullOr(EffectSchema.String)),
});

type GraphqlRequestPayload = typeof GraphqlRequestPayload.Type;

export interface GraphqlTestRequest {
  readonly url: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly payload: GraphqlRequestPayload;
}

export interface GraphqlTestContext {
  readonly request: GraphqlTestRequest;
}

export interface GraphqlTestServerOptions {
  readonly schema: GraphQLSchema;
  readonly path?: string;
}

export interface GraphqlTestServerShape {
  readonly endpoint: string;
  readonly schema: GraphQLSchema;
  readonly requests: Effect.Effect<readonly GraphqlTestRequest[]>;
  readonly clearRequests: Effect.Effect<void>;
}

class GraphqlTestServerAddressError extends Data.TaggedError("GraphqlTestServerAddressError")<{
  readonly address: unknown;
}> {}

class GraphqlTestServerListenError extends Data.TaggedError("GraphqlTestServerListenError")<{
  readonly cause: unknown;
}> {}

const headersFromRequest = (
  headers: Headers | IncomingHttpHeaders,
): Readonly<Record<string, string>> => {
  if ("entries" in headers && typeof headers.entries === "function") {
    return Object.fromEntries(headers.entries());
  }
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      if (value === undefined) return [];
      return [[name, Array.isArray(value) ? value.join(", ") : value]];
    }),
  );
};

const payloadFromParams = (params: GraphQLParams): GraphqlRequestPayload => ({
  query: params.query,
  variables:
    typeof params.variables === "object" && params.variables !== null
      ? params.variables
      : undefined,
  operationName: params.operationName ?? null,
});

const captureRequest = (
  initial: YogaInitialContext,
  requests: Ref.Ref<readonly GraphqlTestRequest[]>,
) => {
  const url = new URL(initial.request.url);
  const captured: GraphqlTestRequest = {
    url: initial.request.url,
    method: initial.request.method,
    path: url.pathname,
    headers: headersFromRequest(initial.request.headers),
    payload: payloadFromParams(initial.params),
  };
  return Effect.runPromise(
    Ref.update(requests, (all) => [...all, captured]).pipe(Effect.as(captured)),
  );
};

const closeServer = (server: Server): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    server.close(() => resume(Effect.void));
  });

export const serveGraphqlTestServer = (
  options: GraphqlTestServerOptions,
): Effect.Effect<
  GraphqlTestServerShape,
  GraphqlTestServerAddressError | GraphqlTestServerListenError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<readonly GraphqlTestRequest[]>([]);
    const path = options.path ?? "/graphql";

    const yoga = createYoga<Record<string, never>, GraphqlTestContext>({
      schema: options.schema,
      graphqlEndpoint: path,
      graphiql: false,
      landingPage: false,
      logging: false,
      maskedErrors: false,
      context: (initial) =>
        captureRequest(initial, requests).then((request) => ({
          request,
        })),
    });
    const server = createServer(yoga);

    const port = yield* Effect.acquireRelease(
      Effect.callback<number, GraphqlTestServerAddressError | GraphqlTestServerListenError>(
        (resume) => {
          const onError = (cause: unknown) =>
            resume(Effect.fail(new GraphqlTestServerListenError({ cause })));
          server.once("error", onError);
          server.listen(0, "127.0.0.1", () => {
            server.off("error", onError);
            const address = server.address();
            if (!address || typeof address === "string") {
              resume(Effect.fail(new GraphqlTestServerAddressError({ address })));
              return;
            }
            resume(Effect.succeed(address.port));
          });
        },
      ),
      () => closeServer(server),
    );

    return {
      endpoint: `http://127.0.0.1:${port}${path}`,
      schema: options.schema,
      requests: Ref.get(requests),
      clearRequests: Ref.set(requests, []),
    };
  });

export class GraphqlTestServer extends Context.Service<GraphqlTestServer, GraphqlTestServerShape>()(
  "@executor-js/plugin-graphql/testing/GraphqlTestServer",
) {
  static readonly layer = (options: GraphqlTestServerOptions) =>
    Layer.effect(GraphqlTestServer, serveGraphqlTestServer(options));
}

const stringArgument = (
  args: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string => {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
};

export const makeGreetingGraphqlSchema = (): GraphQLSchema => {
  const Query = new GraphQLObjectType<unknown, GraphqlTestContext>({
    name: "Query",
    fields: {
      hello: {
        type: GraphQLString,
        description: "Say hello",
        args: {
          name: { type: GraphQLString },
        },
        resolve: (_source, args) => `Hello ${stringArgument(args, "name", "world")}`,
      },
    },
  });

  const Mutation = new GraphQLObjectType<unknown, GraphqlTestContext>({
    name: "Mutation",
    fields: {
      setGreeting: {
        type: GraphQLString,
        description: "Set greeting message",
        args: {
          message: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_source, args) => stringArgument(args, "message", ""),
      },
    },
  });

  return new GraphQLSchema({ query: Query, mutation: Mutation });
};

export const TestLayers = {
  greeting: () => GraphqlTestServer.layer({ schema: makeGreetingGraphqlSchema() }),
};
