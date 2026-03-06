import * as Effect from "effect/Effect";

import {
  type ControlPlaneActorResolverShape,
  type ControlPlaneServiceShape,
} from "#api";
import {
  createSqlControlPlanePersistence,
  SqlPersistenceBootstrapError,
  type CreateSqlRuntimeOptions,
  type SqlControlPlanePersistence,
} from "#persistence";

import {
  ControlPlaneAuthHeaders,
  createHeaderActorResolver,
} from "./actor-resolver";
import type { LocalInstallation } from "#schema";
import {
  getOrProvisionLocalInstallation,
} from "./local-installation";
import {
  type ResolveExecutionEnvironment,
} from "./execution-state";
import {
  createLiveExecutionManager,
} from "./live-execution";
import {
  createWorkspaceExecutionEnvironmentResolver,
} from "./workspace-execution-environment";
import {
  createRuntimeSourceAuthService,
  type ResolveSecretMaterial,
} from "./source-auth-service";
import { createRuntimeControlPlaneService } from "./services";

export {
  ControlPlaneAuthHeaders,
  createHeaderActorResolver,
  createRuntimeControlPlaneService,
};

export * from "./execution-state";
export * from "./live-execution";
export * from "./local-installation";
export * from "./source-auth-service";
export * from "./workspace-execution-environment";

export type RuntimeControlPlaneInput = {
  persistence: SqlControlPlanePersistence;
  actorResolver?: ControlPlaneActorResolverShape;
  executionResolver?: ResolveExecutionEnvironment;
  resolveSecretMaterial?: ResolveSecretMaterial;
  getLocalServerBaseUrl?: () => string | undefined;
};

export const createRuntimeControlPlane = (
  input: RuntimeControlPlaneInput,
): {
  service: ControlPlaneServiceShape;
  actorResolver: ControlPlaneActorResolverShape;
} => {
  const liveExecutionManager = createLiveExecutionManager();
  const sourceAuthService = createRuntimeSourceAuthService({
    rows: input.persistence.rows,
    liveExecutionManager,
    getLocalServerBaseUrl: input.getLocalServerBaseUrl,
  });
  const executionResolver =
    input.executionResolver
    ?? createWorkspaceExecutionEnvironmentResolver({
      rows: input.persistence.rows,
      resolveSecretMaterial: input.resolveSecretMaterial,
      sourceAuthService,
    });
  const service = createRuntimeControlPlaneService(input.persistence.rows, {
    executionResolver,
    liveExecutionManager,
    sourceAuthService,
  });
  const actorResolver = input.actorResolver ?? createHeaderActorResolver(input.persistence.rows);

  return {
    service,
    actorResolver,
  };
};

export type SqlControlPlaneRuntime = {
  persistence: SqlControlPlanePersistence;
  localInstallation: LocalInstallation;
  service: ControlPlaneServiceShape;
  actorResolver: ControlPlaneActorResolverShape;
  close: () => Promise<void>;
};

export type CreateSqlControlPlaneRuntimeOptions = CreateSqlRuntimeOptions & {
  actorResolver?: ControlPlaneActorResolverShape;
  executionResolver?: ResolveExecutionEnvironment;
  resolveSecretMaterial?: ResolveSecretMaterial;
  getLocalServerBaseUrl?: () => string | undefined;
};

export const createSqlControlPlaneRuntime = (
  options: CreateSqlControlPlaneRuntimeOptions,
): Effect.Effect<SqlControlPlaneRuntime, SqlPersistenceBootstrapError> =>
  Effect.flatMap(createSqlControlPlanePersistence(options), (persistence) =>
    Effect.gen(function* () {
      const runtime = createRuntimeControlPlane({
        persistence,
        actorResolver: options.actorResolver,
        executionResolver: options.executionResolver,
        resolveSecretMaterial: options.resolveSecretMaterial,
        getLocalServerBaseUrl: options.getLocalServerBaseUrl,
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
        close: () => persistence.close(),
      };
    })
  );
