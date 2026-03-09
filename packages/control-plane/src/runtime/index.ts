import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import {
  type ControlPlaneApiRuntimeContext,
  ControlPlaneActorResolver,
  type ControlPlaneActorResolverShape,
} from "#api";
import {
  SqlControlPlanePersistenceLive,
  SqlControlPlanePersistenceService,
  SqlControlPlaneRowsLive,
  SqlPersistenceBootstrapError,
  type CreateSqlRuntimeOptions,
  type SqlControlPlanePersistence,
} from "#persistence";
import type { LocalInstallation } from "#schema";

import {
  ControlPlaneAuthHeaders,
  RuntimeActorResolverLive,
  createHeaderActorResolver,
} from "./actor-resolver";
import { type ResolveExecutionEnvironment } from "./execution-state";
import {
  LiveExecutionManagerLive,
  LiveExecutionManagerService,
} from "./live-execution";
import { getOrProvisionLocalInstallation } from "./local-installation";
import {
  ControlPlaneStore,
  ControlPlaneStoreLive,
} from "./store";
import {
  RuntimeSourceAuthServiceLive,
  RuntimeSourceAuthServiceTag,
} from "./source-auth-service";
import type { ResolveSecretMaterial } from "./secret-material-providers";
import {
  RuntimeExecutionResolverLive,
  RuntimeExecutionResolverService,
} from "./workspace-execution-environment";

export {
  ControlPlaneAuthHeaders,
  createHeaderActorResolver,
};

export * from "./execution-state";
export * from "./executor-tools";
export * from "./live-execution";
export * from "./local-installation";
export * from "./schema-type-signature";
export * from "./source-auth-service";
export * from "./secret-material-providers";
export * from "./source-credential-interactions";
export * from "./store";
export * from "./workspace-execution-environment";
export * from "./source-inspection";
export * from "./source-discovery";
export * from "./execution-service";

export type RuntimeControlPlaneOptions = {
  actorResolver?: ControlPlaneActorResolverShape;
  executionResolver?: ResolveExecutionEnvironment;
  resolveSecretMaterial?: ResolveSecretMaterial;
  getLocalServerBaseUrl?: () => string | undefined;
};

const detailsFromCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toLocalInstallationBootstrapError = (
  cause: unknown,
): SqlPersistenceBootstrapError => {
  const details = detailsFromCause(cause);
  return new SqlPersistenceBootstrapError({
    message: `Failed provisioning local installation: ${details}`,
    details,
  });
};

const closeScope = (scope: Scope.CloseableScope) =>
  Scope.close(scope, Exit.void).pipe(Effect.orDie);

export type RuntimeControlPlaneLayer = Layer.Layer<
  ControlPlaneApiRuntimeContext,
  never,
  never
>;

const runtimeContextTags = [
  ControlPlaneActorResolver,
  ControlPlaneStore,
  LiveExecutionManagerService,
  RuntimeSourceAuthServiceTag,
  RuntimeExecutionResolverService,
] as const;

const createRuntimeLayerFromContext = (
  context: Context.Context<
    ControlPlaneActorResolver
    | ControlPlaneStore
    | LiveExecutionManagerService
    | RuntimeSourceAuthServiceTag
    | RuntimeExecutionResolverService
  >,
): RuntimeControlPlaneLayer => {
  const runtimeContext = context.pipe(
    Context.pick(...runtimeContextTags),
  ) as Context.Context<
    ControlPlaneActorResolver
    | ControlPlaneStore
    | LiveExecutionManagerService
    | RuntimeSourceAuthServiceTag
    | RuntimeExecutionResolverService
  >;

  return Layer.succeedContext(runtimeContext) as RuntimeControlPlaneLayer;
};

export const createRuntimeControlPlaneLayer = (
  options: RuntimeControlPlaneOptions = {},
) => {
  const liveExecutionManagerLayer = LiveExecutionManagerLive;
  const sourceAuthLayer = RuntimeSourceAuthServiceLive({
    getLocalServerBaseUrl: options.getLocalServerBaseUrl,
  }).pipe(
    Layer.provide(liveExecutionManagerLayer),
  );
  const executionResolverLayer = RuntimeExecutionResolverLive({
    executionResolver: options.executionResolver,
    resolveSecretMaterial: options.resolveSecretMaterial,
  }).pipe(
    Layer.provide(sourceAuthLayer),
  );

  return Layer.mergeAll(
    ControlPlaneStoreLive,
    RuntimeActorResolverLive(options.actorResolver),
    liveExecutionManagerLayer,
    sourceAuthLayer,
    executionResolverLayer,
  );
};

export type SqlControlPlaneRuntime = {
  persistence: SqlControlPlanePersistence;
  localInstallation: LocalInstallation;
  runtimeLayer: RuntimeControlPlaneLayer;
  close: () => Promise<void>;
};

export type CreateSqlControlPlaneRuntimeOptions = CreateSqlRuntimeOptions
  & RuntimeControlPlaneOptions;

export const createSqlControlPlaneRuntime = (
  options: CreateSqlControlPlaneRuntimeOptions,
): Effect.Effect<SqlControlPlaneRuntime, SqlPersistenceBootstrapError> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const persistenceAndRowsLayer = SqlControlPlaneRowsLive.pipe(
      Layer.provideMerge(SqlControlPlanePersistenceLive(options)),
    );
    const runtimeLayer = createRuntimeControlPlaneLayer(options).pipe(
      Layer.provideMerge(persistenceAndRowsLayer),
    );

    const context = yield* Layer.buildWithScope(runtimeLayer, scope).pipe(
      Effect.catchAll((error) =>
        closeScope(scope).pipe(
          Effect.zipRight(Effect.fail(error)),
        )),
    );

    const persistence = Context.get(context, SqlControlPlanePersistenceService);
    const store = Context.get(context, ControlPlaneStore);
    const concreteRuntimeLayer = createRuntimeLayerFromContext(context);

    const localInstallation = yield* getOrProvisionLocalInstallation(store).pipe(
      Effect.mapError(toLocalInstallationBootstrapError),
      Effect.catchAll((error) =>
        closeScope(scope).pipe(
          Effect.zipRight(Effect.fail(error)),
        )),
    );

    return {
      persistence,
      localInstallation,
      runtimeLayer: concreteRuntimeLayer,
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => {}),
    };
  });
