import { HttpApiBuilder } from "@effect/platform";
import { Cause, Context, Effect } from "effect";

import { addGroup } from "@executor/api";
import { GraphqlExtractionError, GraphqlIntrospectionError } from "../sdk/errors";
import type { GraphqlPluginExtension, HeaderValue, GraphqlUpdateSourceInput } from "../sdk/plugin";
import { GraphqlGroup, GraphqlInternalError } from "./group";

// ---------------------------------------------------------------------------
// Service tag — the server provides the GraphQL extension
// ---------------------------------------------------------------------------

export class GraphqlExtensionService extends Context.Tag("GraphqlExtensionService")<
  GraphqlExtensionService,
  GraphqlPluginExtension
>() {}

// ---------------------------------------------------------------------------
// Failure mapping
// ---------------------------------------------------------------------------

type GraphqlAddSourceFailure =
  | GraphqlIntrospectionError
  | GraphqlExtractionError
  | GraphqlInternalError;

const toGraphqlAddSourceFailure = (error: unknown): GraphqlAddSourceFailure => {
  if (
    error instanceof GraphqlIntrospectionError ||
    error instanceof GraphqlExtractionError ||
    error instanceof GraphqlInternalError
  ) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new GraphqlInternalError({ message });
};

const sanitizeAddSourceFailure = <A, R>(
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, GraphqlAddSourceFailure, R> =>
  Effect.catchAllCause(effect, (cause) =>
    Effect.fail(toGraphqlAddSourceFailure(Cause.squash(cause))),
  );

const toGraphqlInternalError = (error: unknown): GraphqlInternalError => {
  if (error instanceof GraphqlInternalError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new GraphqlInternalError({ message });
};

const sanitizeInternalFailure = <A, R>(
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, GraphqlInternalError, R> =>
  Effect.catchAllCause(effect, (cause) =>
    Effect.fail(toGraphqlInternalError(Cause.squash(cause))),
  );

// ---------------------------------------------------------------------------
// Composed API — core + graphql group
// ---------------------------------------------------------------------------

const ExecutorApiWithGraphql = addGroup(GraphqlGroup);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const GraphqlHandlers = HttpApiBuilder.group(ExecutorApiWithGraphql, "graphql", (handlers) =>
  handlers
    .handle("addSource", ({ payload }) =>
      Effect.gen(function* () {
        const ext = yield* GraphqlExtensionService;
        const result = yield* ext.addSource({
          endpoint: payload.endpoint,
          name: payload.name,
          introspectionJson: payload.introspectionJson,
          namespace: payload.namespace,
          headers: payload.headers as Record<string, HeaderValue> | undefined,
        });
        return {
          toolCount: result.toolCount,
          namespace: payload.namespace ?? "graphql",
        };
      }).pipe(sanitizeAddSourceFailure),
    )
    .handle("getSource", ({ path }) =>
      Effect.gen(function* () {
        const ext = yield* GraphqlExtensionService;
        return yield* ext.getSource(path.namespace);
      }).pipe(sanitizeInternalFailure),
    )
    .handle("updateSource", ({ path, payload }) =>
      Effect.gen(function* () {
        const ext = yield* GraphqlExtensionService;
        yield* ext.updateSource(path.namespace, {
          name: payload.name,
          endpoint: payload.endpoint,
          headers: payload.headers as Record<string, HeaderValue> | undefined,
        } as GraphqlUpdateSourceInput);
        return { updated: true };
      }).pipe(sanitizeInternalFailure),
    ),
);
