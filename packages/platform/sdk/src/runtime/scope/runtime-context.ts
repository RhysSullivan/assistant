import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type {
  ScopeId,
} from "#schema";
import type {
  ExecutorScopeContext,
} from "../../scope";
import type {
  LoadedExecutorScopeConfig,
} from "../scope-config";
import {
  RuntimeLocalScopeMismatchError,
  RuntimeLocalScopeUnavailableError,
} from "../scope-errors";

export type RuntimeLocalScopeState = {
  scope: ExecutorScopeContext;
  installation: {
    scopeId: ScopeId;
    actorScopeId: ScopeId;
  };
  loadedConfig: LoadedExecutorScopeConfig;
};

export class RuntimeLocalScopeService extends Context.Tag(
  "#runtime/RuntimeLocalScopeService",
)<RuntimeLocalScopeService, RuntimeLocalScopeState>() {}

export const RuntimeLocalScopeLive = (
  runtimeLocalScope: RuntimeLocalScopeState,
) => Layer.succeed(RuntimeLocalScopeService, runtimeLocalScope);

export const provideOptionalRuntimeLocalScope = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtimeLocalScope: RuntimeLocalScopeState | null | undefined,
): Effect.Effect<A, E, R> =>
  runtimeLocalScope === null || runtimeLocalScope === undefined
    ? effect
    : effect.pipe(Effect.provide(RuntimeLocalScopeLive(runtimeLocalScope)));

export const getRuntimeLocalScopeOption = () =>
  Effect.contextWith((context) =>
    Context.getOption(context, RuntimeLocalScopeService),
  ).pipe(
    Effect.map((option) => (Option.isSome(option) ? option.value : null)),
  ) as Effect.Effect<RuntimeLocalScopeState | null, never, never>;

export const requireRuntimeLocalScope = (
  scopeId?: ScopeId,
): Effect.Effect<
  RuntimeLocalScopeState,
  RuntimeLocalScopeUnavailableError | RuntimeLocalScopeMismatchError,
  never
> =>
  Effect.gen(function* () {
    const runtimeLocalScope = yield* getRuntimeLocalScopeOption();
    if (runtimeLocalScope === null) {
      return yield* new RuntimeLocalScopeUnavailableError({
          message: "Runtime local scope is unavailable",
        });
    }

    if (
      scopeId !== undefined
      && runtimeLocalScope.installation.scopeId !== scopeId
    ) {
      return yield* new RuntimeLocalScopeMismatchError({
          message: `Scope ${scopeId} is not the active local scope ${runtimeLocalScope.installation.scopeId}`,
          requestedScopeId: scopeId,
          activeScopeId: runtimeLocalScope.installation.scopeId,
        });
    }

    return runtimeLocalScope;
  });

export const requireRuntimeLocalActorScopeId = (scopeId?: ScopeId) =>
  requireRuntimeLocalScope(scopeId).pipe(
    Effect.map((runtimeLocalScope) => runtimeLocalScope.installation.actorScopeId),
  );
