import * as Effect from "effect/Effect";

import {
  provideOptionalRuntimeLocalScope,
  type RuntimeLocalScopeState,
} from "../../scope/runtime-context";

export const provideRuntimeLocalScope = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtimeLocalScope: RuntimeLocalScopeState | null,
): Effect.Effect<A, E, R> =>
  provideOptionalRuntimeLocalScope(effect, runtimeLocalScope);
