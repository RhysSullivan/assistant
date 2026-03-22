import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  AuthArtifact,
  AuthLease,
  Execution,
  ExecutionInteraction,
  ExecutionStep,
  ProviderAuthGrant,
  SecretMaterial,
  SourceAuthSession,
  ScopeOauthClient,
  ScopedSourceOauthClient,
} from "#schema";

type SecretMaterialSummary = {
  id: string;
  providerId: string;
  name: string | null;
  purpose: string;
  createdAt: number;
  updatedAt: number;
};

export type ExecutorStateStoreShape = {
  authArtifacts: {
    listByScopeId: (
      scopeId: AuthArtifact["scopeId"],
    ) => Effect.Effect<readonly AuthArtifact[], Error, never>;
    listByScopeAndSourceId: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
    }) => Effect.Effect<readonly AuthArtifact[], Error, never>;
    getByScopeSourceAndActor: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
      actorScopeId: AuthArtifact["actorScopeId"];
      slot: AuthArtifact["slot"];
    }) => Effect.Effect<import("effect/Option").Option<AuthArtifact>, Error, never>;
    upsert: (artifact: AuthArtifact) => Effect.Effect<void, Error, never>;
    removeByScopeSourceAndActor: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
      actorScopeId: AuthArtifact["actorScopeId"];
      slot?: AuthArtifact["slot"];
    }) => Effect.Effect<boolean, Error, never>;
    removeByScopeAndSourceId: (input: {
      scopeId: AuthArtifact["scopeId"];
      sourceId: AuthArtifact["sourceId"];
    }) => Effect.Effect<number, Error, never>;
  };
  authLeases: {
    listAll: () => Effect.Effect<readonly AuthLease[], Error, never>;
    getByAuthArtifactId: (
      authArtifactId: AuthLease["authArtifactId"],
    ) => Effect.Effect<import("effect/Option").Option<AuthLease>, Error, never>;
    upsert: (lease: AuthLease) => Effect.Effect<void, Error, never>;
    removeByAuthArtifactId: (
      authArtifactId: AuthLease["authArtifactId"],
    ) => Effect.Effect<boolean, Error, never>;
  };
  sourceOauthClients: {
    getByScopeSourceAndProvider: (input: {
      scopeId: ScopedSourceOauthClient["scopeId"];
      sourceId: ScopedSourceOauthClient["sourceId"];
      providerKey: string;
    }) => Effect.Effect<
      import("effect/Option").Option<ScopedSourceOauthClient>,
      Error,
      never
    >;
    upsert: (
      oauthClient: ScopedSourceOauthClient,
    ) => Effect.Effect<void, Error, never>;
    removeByScopeAndSourceId: (input: {
      scopeId: ScopedSourceOauthClient["scopeId"];
      sourceId: ScopedSourceOauthClient["sourceId"];
    }) => Effect.Effect<number, Error, never>;
  };
  scopeOauthClients: {
    listByScopeAndProvider: (input: {
      scopeId: ScopeOauthClient["scopeId"];
      providerKey: string;
    }) => Effect.Effect<readonly ScopeOauthClient[], Error, never>;
    getById: (
      id: ScopeOauthClient["id"],
    ) => Effect.Effect<import("effect/Option").Option<ScopeOauthClient>, Error, never>;
    upsert: (oauthClient: ScopeOauthClient) => Effect.Effect<void, Error, never>;
    removeById: (id: ScopeOauthClient["id"]) => Effect.Effect<boolean, Error, never>;
  };
  providerAuthGrants: {
    listByScopeId: (
      scopeId: ProviderAuthGrant["scopeId"],
    ) => Effect.Effect<readonly ProviderAuthGrant[], Error, never>;
    listByScopeActorAndProvider: (input: {
      scopeId: ProviderAuthGrant["scopeId"];
      actorScopeId: ProviderAuthGrant["actorScopeId"];
      providerKey: string;
    }) => Effect.Effect<readonly ProviderAuthGrant[], Error, never>;
    getById: (
      id: ProviderAuthGrant["id"],
    ) => Effect.Effect<import("effect/Option").Option<ProviderAuthGrant>, Error, never>;
    upsert: (grant: ProviderAuthGrant) => Effect.Effect<void, Error, never>;
    removeById: (id: ProviderAuthGrant["id"]) => Effect.Effect<boolean, Error, never>;
  };
  sourceAuthSessions: {
    listAll: () => Effect.Effect<readonly SourceAuthSession[], Error, never>;
    listByScopeId: (
      scopeId: SourceAuthSession["scopeId"],
    ) => Effect.Effect<readonly SourceAuthSession[], Error, never>;
    getById: (
      id: SourceAuthSession["id"],
    ) => Effect.Effect<import("effect/Option").Option<SourceAuthSession>, Error, never>;
    getByState: (
      state: SourceAuthSession["state"],
    ) => Effect.Effect<import("effect/Option").Option<SourceAuthSession>, Error, never>;
    getPendingByScopeSourceAndActor: (input: {
      scopeId: SourceAuthSession["scopeId"];
      sourceId: SourceAuthSession["sourceId"];
      actorScopeId: SourceAuthSession["actorScopeId"];
      credentialSlot?: SourceAuthSession["credentialSlot"];
    }) => Effect.Effect<
      import("effect/Option").Option<SourceAuthSession>,
      Error,
      never
    >;
    insert: (session: SourceAuthSession) => Effect.Effect<void, Error, never>;
    update: (
      id: SourceAuthSession["id"],
      patch: Partial<
        Omit<SourceAuthSession, "id" | "scopeId" | "sourceId" | "createdAt">
      >,
    ) => Effect.Effect<import("effect/Option").Option<SourceAuthSession>, Error, never>;
    upsert: (session: SourceAuthSession) => Effect.Effect<void, Error, never>;
    removeByScopeAndSourceId: (
      scopeId: SourceAuthSession["scopeId"],
      sourceId: SourceAuthSession["sourceId"],
    ) => Effect.Effect<boolean, Error, never>;
  };
  secretMaterials: {
    getById: (
      id: SecretMaterial["id"],
    ) => Effect.Effect<import("effect/Option").Option<SecretMaterial>, Error, never>;
    listAll: () => Effect.Effect<readonly SecretMaterialSummary[], Error, never>;
    upsert: (material: SecretMaterial) => Effect.Effect<void, Error, never>;
    updateById: (
      id: SecretMaterial["id"],
      update: { name?: string | null; value?: string },
    ) => Effect.Effect<
      import("effect/Option").Option<SecretMaterialSummary>,
      Error,
      never
    >;
    removeById: (id: SecretMaterial["id"]) => Effect.Effect<boolean, Error, never>;
  };
  executions: {
    getById: (
      executionId: Execution["id"],
    ) => Effect.Effect<import("effect/Option").Option<Execution>, Error, never>;
    getByScopeAndId: (
      scopeId: Execution["scopeId"],
      executionId: Execution["id"],
    ) => Effect.Effect<import("effect/Option").Option<Execution>, Error, never>;
    insert: (execution: Execution) => Effect.Effect<void, Error, never>;
    update: (
      executionId: Execution["id"],
      patch: Partial<
        Omit<Execution, "id" | "scopeId" | "createdByScopeId" | "createdAt">
      >,
    ) => Effect.Effect<import("effect/Option").Option<Execution>, Error, never>;
  };
  executionInteractions: {
    getById: (
      interactionId: ExecutionInteraction["id"],
    ) => Effect.Effect<
      import("effect/Option").Option<ExecutionInteraction>,
      Error,
      never
    >;
    listByExecutionId: (
      executionId: ExecutionInteraction["executionId"],
    ) => Effect.Effect<readonly ExecutionInteraction[], Error, never>;
    getPendingByExecutionId: (
      executionId: ExecutionInteraction["executionId"],
    ) => Effect.Effect<
      import("effect/Option").Option<ExecutionInteraction>,
      Error,
      never
    >;
    insert: (
      interaction: ExecutionInteraction,
    ) => Effect.Effect<void, Error, never>;
    update: (
      interactionId: ExecutionInteraction["id"],
      patch: Partial<
        Omit<ExecutionInteraction, "id" | "executionId" | "createdAt">
      >,
    ) => Effect.Effect<
      import("effect/Option").Option<ExecutionInteraction>,
      Error,
      never
    >;
  };
  executionSteps: {
    getByExecutionAndSequence: (
      executionId: ExecutionStep["executionId"],
      sequence: ExecutionStep["sequence"],
    ) => Effect.Effect<import("effect/Option").Option<ExecutionStep>, Error, never>;
    listByExecutionId: (
      executionId: ExecutionStep["executionId"],
    ) => Effect.Effect<readonly ExecutionStep[], Error, never>;
    insert: (step: ExecutionStep) => Effect.Effect<void, Error, never>;
    deleteByExecutionId: (
      executionId: ExecutionStep["executionId"],
    ) => Effect.Effect<void, Error, never>;
    updateByExecutionAndSequence: (
      executionId: ExecutionStep["executionId"],
      sequence: ExecutionStep["sequence"],
      patch: Partial<
        Omit<ExecutionStep, "id" | "executionId" | "sequence" | "createdAt">
      >,
    ) => Effect.Effect<import("effect/Option").Option<ExecutionStep>, Error, never>;
  };
};

export class ExecutorStateStore extends Context.Tag(
  "#runtime/ExecutorStateStore",
)<ExecutorStateStore, ExecutorStateStoreShape>() {}
