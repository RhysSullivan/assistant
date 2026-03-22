import {
  HttpApiBuilder,
  HttpApiClient,
} from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import {
  ControlPlaneApi,
  createControlPlaneApiLayer,
} from "../../../../api/src/index";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  createExecutorEffect,
  type ControlPlaneRuntime,
} from "../../index";

const createClientLayer = (runtime: ControlPlaneRuntime) => {
  const apiLayer = Layer.unwrapEffect(
    Effect.map(
      createExecutorEffect({
        backend: {
          createRuntime: () => Effect.succeed(runtime),
        },
      }),
      createControlPlaneApiLayer,
    ),
  );

  return HttpApiBuilder.serve().pipe(
    Layer.provide(apiLayer),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
};

const createControlPlaneClient = () =>
  HttpApiClient.make(ControlPlaneApi, {
  });

type ControlPlaneClient = Effect.Effect.Success<
  ReturnType<typeof createControlPlaneClient>
>;

export const withControlPlaneClient = <A, E>(
  input: {
    runtime: ControlPlaneRuntime;
    accountId?: string;
  },
  f: (client: ControlPlaneClient) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const client = yield* createControlPlaneClient();
    return yield* f(client);
  }).pipe(Effect.provide(createClientLayer(input.runtime).pipe(Layer.orDie)));
