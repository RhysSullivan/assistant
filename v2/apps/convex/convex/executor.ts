import type { ExecuteRunInput, ExecuteRunResult } from "@executor-v2/sdk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ConvexRunExecutor,
  ConvexRunExecutorLive,
  ConvexToolProviderRegistryLive,
} from "./run_executor";

const ConvexExecuteDependenciesLive = Layer.merge(
  ConvexRunExecutorLive,
  ConvexToolProviderRegistryLive,
);

export const executeRunImpl = (
  input: ExecuteRunInput,
): Effect.Effect<ExecuteRunResult> =>
  Effect.gen(function* () {
    const runExecutor = yield* ConvexRunExecutor;
    return yield* runExecutor.executeRun(input);
  }).pipe(Effect.provide(ConvexExecuteDependenciesLive));
