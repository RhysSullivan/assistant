import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ControlPlaneActorResolver,
  ControlPlaneService,
  makeControlPlaneWebHandler,
  type ControlPlaneActorResolverShape,
  type ControlPlaneServiceShape,
} from "#api";
import {
  makeSqlControlPlanePersistence,
  SqlPersistenceBootstrapError,
  type CreateSqlRuntimeOptions,
  type SqlControlPlanePersistence,
} from "#persistence";

import {
  ControlPlaneAuthHeaders,
  makeHeaderActorResolver,
} from "./actor-resolver";
import {
  makeInMemorySecretProvider,
  makeSecretStore,
  type SecretStore,
} from "./secret-store";
import type { LocalInstallation } from "#schema";
import {
  getOrProvisionLocalInstallation,
} from "./local-installation";
import {
  type ResolveExecutionEnvironment,
} from "./execution-state";
import {
  makeLiveExecutionManager,
} from "./live-execution";
import { makeRuntimeControlPlaneService } from "./services";

export {
  ControlPlaneAuthHeaders,
  makeHeaderActorResolver,
  makeRuntimeControlPlaneService,
  makeSecretStore,
  makeInMemorySecretProvider,
};

export type { SecretHandle, SecretProvider, SecretStore } from "./secret-store";
export * from "./execution-state";
export * from "./live-execution";
export * from "./local-installation";
export * from "./source-runtime";

export type RuntimeControlPlaneInput = {
  persistence: SqlControlPlanePersistence;
  actorResolver?: ControlPlaneActorResolverShape;
  secretStore?: SecretStore;
  executionResolver?: ResolveExecutionEnvironment;
};

export const makeRuntimeControlPlane = (
  input: RuntimeControlPlaneInput,
): {
  service: ControlPlaneServiceShape;
  actorResolver: ControlPlaneActorResolverShape;
  secretStore: SecretStore;
  webHandler: ReturnType<typeof makeControlPlaneWebHandler>;
} => {
  const liveExecutionManager = makeLiveExecutionManager();
  const service = makeRuntimeControlPlaneService(input.persistence.rows, {
    executionResolver: input.executionResolver,
    liveExecutionManager,
  });
  const actorResolver = input.actorResolver ?? makeHeaderActorResolver(input.persistence.rows);
  const secretStore =
    input.secretStore
    ?? makeSecretStore({
      providers: [makeInMemorySecretProvider("memory")],
      defaultProviderId: "memory",
    });

  const serviceLayer = Layer.succeed(ControlPlaneService, service);
  const actorResolverLayer = Layer.succeed(ControlPlaneActorResolver, actorResolver);

  const webHandler = makeControlPlaneWebHandler(serviceLayer, actorResolverLayer);

  return {
    service,
    actorResolver,
    secretStore,
    webHandler,
  };
};

export type SqlControlPlaneRuntime = {
  persistence: SqlControlPlanePersistence;
  localInstallation: LocalInstallation;
  service: ControlPlaneServiceShape;
  actorResolver: ControlPlaneActorResolverShape;
  secretStore: SecretStore;
  webHandler: ReturnType<typeof makeControlPlaneWebHandler>;
  close: () => Promise<void>;
};

export type CreateSqlControlPlaneRuntimeOptions = CreateSqlRuntimeOptions & {
  secretStore?: SecretStore;
  actorResolver?: ControlPlaneActorResolverShape;
  executionResolver?: ResolveExecutionEnvironment;
};

export const makeSqlControlPlaneRuntime = (
  options: CreateSqlControlPlaneRuntimeOptions,
): Effect.Effect<SqlControlPlaneRuntime, SqlPersistenceBootstrapError> =>
  Effect.flatMap(makeSqlControlPlanePersistence(options), (persistence) =>
    Effect.gen(function* () {
      const runtime = makeRuntimeControlPlane({
        persistence,
        actorResolver: options.actorResolver,
        secretStore: options.secretStore,
        executionResolver: options.executionResolver,
      });
      const localInstallation = yield* getOrProvisionLocalInstallation(persistence.rows).pipe(
        Effect.mapError((cause) =>
          new SqlPersistenceBootstrapError({
            message: `Failed provisioning local installation: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            details: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
      );

      return {
        persistence,
        localInstallation,
        service: runtime.service,
        actorResolver: runtime.actorResolver,
        secretStore: runtime.secretStore,
        webHandler: runtime.webHandler,
        close: () => persistence.close(),
      };
    })
  );
