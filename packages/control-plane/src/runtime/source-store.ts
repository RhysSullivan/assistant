import type {
  AccountId,
  AuthArtifact,
  CredentialSlot,
  LocalConfigSecretInput,
  LocalConfigSource,
  Source,
  SourceId,
  SourceRecipeId,
  SourceRecipeRevisionId,
  WorkspaceId,
} from "#schema";
import { SourceIdSchema } from "#schema";
import { type SqlControlPlaneRows } from "#persistence";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  createSourceRecipeRecord,
  createSourceRecipeRevisionRecord,
  projectSourceFromStorage,
  projectSourcesFromStorage,
  stableSourceRecipeId,
  stableSourceRecipeRevisionId,
  splitSourceForStorage,
} from "./source-definitions";
import {
  loadLocalExecutorConfig,
  type ResolvedLocalWorkspaceContext,
  writeProjectLocalExecutorConfig,
} from "./local-config";
import {
  readLocalSourceArtifact,
  removeLocalSourceArtifact,
} from "./local-source-artifacts";
import {
  getRuntimeLocalWorkspaceOption,
} from "./local-runtime-context";
import {
  loadLocalWorkspaceState,
  writeLocalWorkspaceState,
  type LocalWorkspaceState,
} from "./local-workspace-state";
import {
  fromConfigSecretProviderId,
  toConfigSecretProviderId,
} from "./local-config-secrets";
import { createDefaultSecretMaterialDeleter } from "./secret-material-providers";
import { authArtifactSecretMaterialRefs } from "./auth-artifacts";
import { removeAuthLeaseAndSecrets } from "./auth-leases";
import { getSourceAdapter } from "./source-adapters";
import { slugify } from "./slug";

const secretRefKey = (ref: { providerId: string; handle: string }): string =>
  `${ref.providerId}:${ref.handle}`;

const cleanupAuthArtifactSecretRefs = (rows: SqlControlPlaneRows, input: {
  previous: AuthArtifact | null;
  next: AuthArtifact | null;
}) =>
  Effect.gen(function* () {
    if (input.previous === null) {
      return;
    }

    const deleteSecretMaterial = createDefaultSecretMaterialDeleter({ rows });
    const nextRefKeys = new Set(
      (input.next === null ? [] : authArtifactSecretMaterialRefs(input.next)).map(secretRefKey),
    );
    const refsToDelete = authArtifactSecretMaterialRefs(input.previous).filter(
      (ref) => !nextRefKeys.has(secretRefKey(ref)),
    );

    yield* Effect.forEach(
      refsToDelete,
      (ref) => Effect.either(deleteSecretMaterial(ref)),
      { discard: true },
    );
  });

const selectPreferredAuthArtifact = (input: {
  authArtifacts: ReadonlyArray<AuthArtifact>;
  actorAccountId?: AccountId | null;
  slot: CredentialSlot;
}): AuthArtifact | null => {
  const matchingSlot = input.authArtifacts.filter((artifact) => artifact.slot === input.slot);

  if (input.actorAccountId !== undefined) {
    const exact = matchingSlot.find((artifact) => artifact.actorAccountId === input.actorAccountId);
    if (exact) {
      return exact;
    }
  }

  return matchingSlot.find((artifact) => artifact.actorAccountId === null) ?? null;
};

const selectExactAuthArtifact = (input: {
  authArtifacts: ReadonlyArray<AuthArtifact>;
  actorAccountId?: AccountId | null;
  slot: CredentialSlot;
}): AuthArtifact | null =>
  input.authArtifacts.find(
    (artifact) =>
      artifact.slot === input.slot
      && artifact.actorAccountId === (input.actorAccountId ?? null),
  ) ?? null;

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const cloneJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const deriveLocalSourceId = (
  source: Pick<Source, "namespace" | "name">,
  used: ReadonlySet<string>,
): SourceId => {
  const base =
    trimOrNull(source.namespace)
    ?? trimOrNull(source.name)
    ?? "source";
  const slugBase = slugify(base) || "source";
  let candidate = slugBase;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${slugBase}-${counter}`;
    counter += 1;
  }
  return SourceIdSchema.make(candidate);
};

const resolveLocalConfigSecretProviderAlias = (config: Awaited<ReturnType<typeof loadLocalExecutorConfig>>["config"]): string | null => {
  const defaultAlias = trimOrNull(config?.secrets?.defaults?.env);
  if (defaultAlias !== null && config?.secrets?.providers?.[defaultAlias]) {
    return defaultAlias;
  }

  return config?.secrets?.providers?.default ? "default" : null;
};

const sourceAuthFromConfigInput = (input: {
  auth: unknown;
  config: Awaited<ReturnType<typeof loadLocalExecutorConfig>>["config"];
  existing: Source["auth"] | null;
}): Source["auth"] => {
  if (input.auth === undefined) {
    return input.existing ?? { kind: "none" };
  }

  if (typeof input.auth === "string") {
    const providerAlias = resolveLocalConfigSecretProviderAlias(input.config);
    return {
      kind: "bearer",
      headerName: "Authorization",
      prefix: "Bearer ",
      token: {
        providerId: providerAlias ? toConfigSecretProviderId(providerAlias) : "env",
        handle: input.auth,
      },
    };
  }

  if (typeof input.auth === "object" && input.auth !== null) {
    const explicit = input.auth as {
      source?: string;
      provider?: string;
      id?: string;
    };
    const providerAlias = trimOrNull(explicit.provider);
    const providerId = providerAlias
      ? toConfigSecretProviderId(providerAlias)
      : explicit.source === "env"
        ? "env"
        : null;
    const handle = trimOrNull(explicit.id);
    if (providerId && handle) {
      return {
        kind: "bearer",
        headerName: "Authorization",
        prefix: "Bearer ",
        token: {
          providerId,
          handle,
        },
      };
    }
  }

  return input.existing ?? { kind: "none" };
};

const configAuthFromSource = (input: {
  source: Source;
  existingConfigAuth: LocalConfigSecretInput | undefined;
  config: Awaited<ReturnType<typeof loadLocalExecutorConfig>>["config"];
}): LocalConfigSecretInput | undefined => {
  if (input.source.auth.kind !== "bearer") {
    return input.existingConfigAuth;
  }

  if (input.source.auth.token.providerId === "env") {
    return input.source.auth.token.handle;
  }

  const provider = fromConfigSecretProviderId(input.source.auth.token.providerId);
  if (provider !== null) {
    const configuredProvider = input.config?.secrets?.providers?.[provider];
    if (configuredProvider) {
      return {
        source: configuredProvider.source,
        provider,
        id: input.source.auth.token.handle,
      };
    }
  }

  return input.existingConfigAuth;
};

const resolveRuntimeLocalWorkspace = (workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* getRuntimeLocalWorkspaceOption();
    if (runtimeLocalWorkspace === null || runtimeLocalWorkspace.installation.workspaceId !== workspaceId) {
      return null;
    }

    const loadedConfig = yield* Effect.tryPromise({
      try: () => loadLocalExecutorConfig(runtimeLocalWorkspace.context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
    const workspaceState = yield* Effect.tryPromise({
      try: () => loadLocalWorkspaceState(runtimeLocalWorkspace.context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    return {
      context: runtimeLocalWorkspace.context,
      installation: runtimeLocalWorkspace.installation,
      loadedConfig,
      workspaceState,
    };
  });

const buildLocalSourceRecord = (input: {
  context: ResolvedLocalWorkspaceContext;
  workspaceId: WorkspaceId;
  loadedConfig: Awaited<ReturnType<typeof loadLocalExecutorConfig>>;
  workspaceState: LocalWorkspaceState;
  sourceId: SourceId;
  actorAccountId?: AccountId | null;
  authArtifacts: ReadonlyArray<AuthArtifact>;
}): Effect.Effect<{
  source: Source;
  sourceId: SourceId;
}, Error, never> =>
  Effect.gen(function* () {
    const sourceConfig = input.loadedConfig.config?.sources?.[input.sourceId];
    if (!sourceConfig) {
      return yield* Effect.fail(new Error(`Configured source not found for id ${input.sourceId}`));
    }

    const existingState = input.workspaceState.sources[input.sourceId];
    const adapter = getSourceAdapter(sourceConfig.kind);
    const baseSource = yield* adapter.validateSource({
      id: SourceIdSchema.make(input.sourceId),
      workspaceId: input.workspaceId,
      name: trimOrNull(sourceConfig.name) ?? input.sourceId,
      kind: sourceConfig.kind,
      endpoint: sourceConfig.connection.endpoint.trim(),
      status: existingState?.status ?? ((sourceConfig.enabled ?? true) ? "connected" : "draft"),
      enabled: sourceConfig.enabled ?? true,
      namespace: trimOrNull(sourceConfig.namespace) ?? input.sourceId,
      bindingVersion: adapter.bindingConfigVersion,
      binding: sourceConfig.binding,
      importAuthPolicy: adapter.defaultImportAuthPolicy,
      importAuth: { kind: "none" },
      auth: sourceAuthFromConfigInput({
        auth: sourceConfig.connection.auth,
        config: input.loadedConfig.config,
        existing: null,
      }),
      sourceHash: existingState?.sourceHash ?? null,
      lastError: existingState?.lastError ?? null,
      createdAt: existingState?.createdAt ?? Date.now(),
      updatedAt: existingState?.updatedAt ?? Date.now(),
    });

    const artifact = yield* Effect.tryPromise({
      try: () => readLocalSourceArtifact({
        context: input.context,
        sourceId: input.sourceId,
      }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    }).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );

    const runtimeAuthArtifact = selectPreferredAuthArtifact({
      authArtifacts: input.authArtifacts.filter((artifactItem) => artifactItem.sourceId === baseSource.id),
      actorAccountId: input.actorAccountId,
      slot: "runtime",
    });
    const importAuthArtifact = selectPreferredAuthArtifact({
      authArtifacts: input.authArtifacts.filter((artifactItem) => artifactItem.sourceId === baseSource.id),
      actorAccountId: input.actorAccountId,
      slot: "import",
    });

    const sourceRecord = {
      id: baseSource.id,
      workspaceId: baseSource.workspaceId,
      recipeId: artifact?.recipeId ?? stableSourceRecipeId(baseSource),
      recipeRevisionId: artifact?.revision.id ?? stableSourceRecipeRevisionId(baseSource),
      name: baseSource.name,
      kind: baseSource.kind,
      endpoint: baseSource.endpoint,
      status: baseSource.status,
      enabled: baseSource.enabled,
      namespace: baseSource.namespace,
      importAuthPolicy: baseSource.importAuthPolicy,
      bindingConfigJson: adapter.serializeBindingConfig(baseSource),
      sourceHash: baseSource.sourceHash,
      lastError: baseSource.lastError,
      createdAt: baseSource.createdAt,
      updatedAt: baseSource.updatedAt,
    };

    const source = yield* projectSourceFromStorage({
      sourceRecord,
      runtimeAuthArtifact,
      importAuthArtifact,
    });

    return {
      source,
      sourceId: input.sourceId,
    };
  });

export const loadSourcesInWorkspace = (
  rows: SqlControlPlaneRows,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
) =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspace(workspaceId);
    if (localWorkspace !== null) {
      const authArtifacts = yield* rows.authArtifacts.listByWorkspaceId(workspaceId);
      return yield* Effect.forEach(
        Object.keys(localWorkspace.loadedConfig.config?.sources ?? {}),
        (sourceId) =>
          Effect.map(
            buildLocalSourceRecord({
              context: localWorkspace.context,
              workspaceId,
              loadedConfig: localWorkspace.loadedConfig,
              workspaceState: localWorkspace.workspaceState,
              sourceId: SourceIdSchema.make(sourceId),
              actorAccountId: options.actorAccountId,
              authArtifacts,
            }),
            ({ source }) => source,
          ),
      );
    }

    const sourceRecords = yield* rows.sources.listByWorkspaceId(workspaceId);
    const authArtifacts = yield* rows.authArtifacts.listByWorkspaceId(workspaceId);
    const filteredAuthArtifacts = sourceRecords.flatMap((sourceRecord) => {
      const matches = authArtifacts.filter((artifact) => artifact.sourceId === sourceRecord.id);
      const preferred = selectPreferredAuthArtifact({
        authArtifacts: matches,
        actorAccountId: options.actorAccountId,
        slot: "runtime",
      });
      const preferredImport = selectPreferredAuthArtifact({
        authArtifacts: matches,
        actorAccountId: options.actorAccountId,
        slot: "import",
      });
      return [preferred, preferredImport].filter(
        (artifact): artifact is AuthArtifact => artifact !== null,
      );
    });

    return yield* projectSourcesFromStorage({
      sourceRecords,
      authArtifacts: filteredAuthArtifacts,
    });
  });

export const loadSourceById = (rows: SqlControlPlaneRows, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  actorAccountId?: AccountId | null;
}) =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspace(input.workspaceId);
    if (localWorkspace !== null) {
      const authArtifacts = yield* rows.authArtifacts.listByWorkspaceId(input.workspaceId);
      if (!localWorkspace.loadedConfig.config?.sources?.[input.sourceId]) {
        return yield* Effect.fail(
          new Error(`Source not found: workspaceId=${input.workspaceId} sourceId=${input.sourceId}`),
        );
      }

      const localSource = yield* buildLocalSourceRecord({
        context: localWorkspace.context,
        workspaceId: input.workspaceId,
        loadedConfig: localWorkspace.loadedConfig,
        workspaceState: localWorkspace.workspaceState,
        sourceId: input.sourceId,
        actorAccountId: input.actorAccountId,
        authArtifacts,
      });

      return localSource.source;
    }

    const sourceRecord = yield* rows.sources.getByWorkspaceAndId(
      input.workspaceId,
      input.sourceId,
    );

    if (Option.isNone(sourceRecord)) {
      return yield* Effect.fail(
        new Error(`Source not found: workspaceId=${input.workspaceId} sourceId=${input.sourceId}`),
      );
    }

    const authArtifacts = yield* rows.authArtifacts.listByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });
    const authArtifact = selectPreferredAuthArtifact({
      authArtifacts,
      actorAccountId: input.actorAccountId,
      slot: "runtime",
    });
    const importAuthArtifact = selectPreferredAuthArtifact({
      authArtifacts,
      actorAccountId: input.actorAccountId,
      slot: "import",
    });

    return yield* projectSourceFromStorage({
      sourceRecord: sourceRecord.value,
      runtimeAuthArtifact: authArtifact,
      importAuthArtifact,
    });
  });

const configSourceFromLocalSource = (input: {
  source: Source;
  existingConfigAuth: LocalConfigSecretInput | undefined;
  config: Awaited<ReturnType<typeof loadLocalExecutorConfig>>["config"];
}): LocalConfigSource => {
  const auth = configAuthFromSource({
    source: input.source,
    existingConfigAuth: input.existingConfigAuth,
    config: input.config,
  });

  const common = {
    ...(trimOrNull(input.source.name) !== trimOrNull(input.source.id)
      ? { name: input.source.name }
      : {}),
    ...(trimOrNull(input.source.namespace) !== trimOrNull(input.source.id)
      ? { namespace: input.source.namespace ?? undefined }
      : {}),
    ...(input.source.enabled === false ? { enabled: false } : {}),
    connection: {
      endpoint: input.source.endpoint,
      ...(auth !== undefined ? { auth } : {}),
    },
  };

  switch (input.source.kind) {
    case "openapi":
      return {
        kind: "openapi",
        ...common,
        binding: cloneJson(input.source.binding) as Extract<LocalConfigSource, { kind: "openapi" }>["binding"],
      };
    case "graphql":
      return {
        kind: "graphql",
        ...common,
        binding: cloneJson(input.source.binding) as Extract<LocalConfigSource, { kind: "graphql" }>["binding"],
      };
    case "google_discovery":
      return {
        kind: "google_discovery",
        ...common,
        binding: cloneJson(input.source.binding) as Extract<LocalConfigSource, { kind: "google_discovery" }>["binding"],
      };
    case "mcp":
      return {
        kind: "mcp",
        ...common,
        binding: cloneJson(input.source.binding) as Extract<LocalConfigSource, { kind: "mcp" }>["binding"],
      };
    default:
      throw new Error(`Unsupported source kind for local config: ${input.source.kind}`);
  }
};

const removeAuthArtifactsForSource = (rows: SqlControlPlaneRows, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}) =>
  Effect.gen(function* () {
    const existingAuthArtifacts = yield* rows.authArtifacts.listByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    yield* rows.authArtifacts.removeByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    yield* Effect.forEach(
      existingAuthArtifacts,
      (artifact) =>
        removeAuthLeaseAndSecrets(rows, {
          authArtifactId: artifact.id,
        }),
      { discard: true },
    );

    yield* Effect.forEach(
      existingAuthArtifacts,
      (artifact) =>
        cleanupAuthArtifactSecretRefs(rows, {
          previous: artifact,
          next: null,
        }),
      { discard: true },
    );

    return existingAuthArtifacts.length;
  });

const cleanupOrphanedRecipeData = (rows: SqlControlPlaneRows, input: {
  recipeId: SourceRecipeId;
  recipeRevisionId: SourceRecipeRevisionId;
}) =>
  Effect.gen(function* () {
    const revisionReferenceCount = yield* rows.sources.countByRecipeRevisionId(
      input.recipeRevisionId,
    );
    if (revisionReferenceCount === 0) {
      yield* rows.sourceRecipeDocuments.removeByRevisionId(input.recipeRevisionId);
      yield* rows.sourceRecipeSchemaBundles.removeByRevisionId(input.recipeRevisionId);
      yield* rows.sourceRecipeOperations.removeByRevisionId(input.recipeRevisionId);
    }

    const recipeReferenceCount = yield* rows.sources.countByRecipeId(input.recipeId);
    if (recipeReferenceCount > 0) {
      return;
    }

    const recipeRevisions = yield* rows.sourceRecipeRevisions.listByRecipeId(input.recipeId);
    yield* Effect.forEach(
      recipeRevisions,
      (recipeRevision) =>
        Effect.all([
          rows.sourceRecipeDocuments.removeByRevisionId(recipeRevision.id),
          rows.sourceRecipeSchemaBundles.removeByRevisionId(recipeRevision.id),
          rows.sourceRecipeOperations.removeByRevisionId(recipeRevision.id),
        ]),
      { discard: true },
    );
    yield* rows.sourceRecipeRevisions.removeByRecipeId(input.recipeId);
    yield* rows.sourceRecipes.removeById(input.recipeId);
  });

export const removeSourceById = (rows: SqlControlPlaneRows, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}) =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspace(input.workspaceId);
    if (localWorkspace !== null) {
      if (!localWorkspace.loadedConfig.config?.sources?.[input.sourceId]) {
        return false;
      }

      const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
      const sources = {
        ...(projectConfig.sources ?? {}),
      };
      delete sources[input.sourceId];
      yield* Effect.tryPromise({
        try: () =>
          writeProjectLocalExecutorConfig({
            context: localWorkspace.context,
            config: {
              ...projectConfig,
              sources,
            },
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      const {
        [input.sourceId]: _removedSource,
        ...remainingSources
      } = localWorkspace.workspaceState.sources;
      const workspaceState: LocalWorkspaceState = {
        ...localWorkspace.workspaceState,
        sources: remainingSources,
      };
      yield* Effect.tryPromise({
        try: () =>
          writeLocalWorkspaceState({
            context: localWorkspace.context,
            state: workspaceState,
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      yield* Effect.tryPromise({
        try: () =>
          removeLocalSourceArtifact({
            context: localWorkspace.context,
            sourceId: input.sourceId,
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      yield* rows.sourceAuthSessions.removeByWorkspaceAndSourceId(
        input.workspaceId,
        input.sourceId,
      );
      yield* rows.sourceOauthClients.removeByWorkspaceAndSourceId({
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
      });
      yield* removeAuthArtifactsForSource(rows, input);
      return true;
    }

    const sourceRecord = yield* rows.sources.getByWorkspaceAndId(input.workspaceId, input.sourceId);
    if (Option.isNone(sourceRecord)) {
      return false;
    }

    yield* rows.sourceAuthSessions.removeByWorkspaceAndSourceId(
      input.workspaceId,
      input.sourceId,
    );
    yield* rows.sourceOauthClients.removeByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });
    yield* removeAuthArtifactsForSource(rows, input);
    const removed = yield* rows.sources.removeByWorkspaceAndId(input.workspaceId, input.sourceId);
    if (!removed) {
      return false;
    }

    yield* cleanupOrphanedRecipeData(rows, {
      recipeId: sourceRecord.value.recipeId,
      recipeRevisionId: sourceRecord.value.recipeRevisionId,
    });

    return true;
  });

export const persistSource = (
  rows: SqlControlPlaneRows,
  source: Source,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
) =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspace(source.workspaceId);
    if (localWorkspace !== null) {
      const nextSource = {
        ...source,
        id:
          localWorkspace.loadedConfig.config?.sources?.[source.id]
          || localWorkspace.workspaceState.sources[source.id]
            ? source.id
            : deriveLocalSourceId(
                source,
                new Set(Object.keys(localWorkspace.loadedConfig.config?.sources ?? {})),
              ),
      } satisfies Source;
      const existingAuthArtifacts = yield* rows.authArtifacts.listByWorkspaceAndSourceId({
        workspaceId: nextSource.workspaceId,
        sourceId: nextSource.id,
      });
      const existingRuntimeAuthArtifact = selectExactAuthArtifact({
        authArtifacts: existingAuthArtifacts,
        actorAccountId: options.actorAccountId,
        slot: "runtime",
      });
      const existingImportAuthArtifact = selectExactAuthArtifact({
        authArtifacts: existingAuthArtifacts,
        actorAccountId: options.actorAccountId,
        slot: "import",
      });
      const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
      const sources = {
        ...(projectConfig.sources ?? {}),
      };
      const existingConfigSource = sources[nextSource.id];
      sources[nextSource.id] = configSourceFromLocalSource({
        source: nextSource,
        existingConfigAuth: existingConfigSource?.connection.auth,
        config: localWorkspace.loadedConfig.config,
      });
      yield* Effect.tryPromise({
        try: () =>
          writeProjectLocalExecutorConfig({
            context: localWorkspace.context,
            config: {
              ...projectConfig,
              sources,
            },
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      const { runtimeAuthArtifact, importAuthArtifact } = splitSourceForStorage({
        source: nextSource,
        recipeId: stableSourceRecipeId(nextSource),
        recipeRevisionId: stableSourceRecipeRevisionId(nextSource),
        actorAccountId: options.actorAccountId,
        existingRuntimeAuthArtifactId: existingRuntimeAuthArtifact?.id ?? null,
        existingImportAuthArtifactId: existingImportAuthArtifact?.id ?? null,
      });

      if (runtimeAuthArtifact === null) {
        if (existingRuntimeAuthArtifact !== null) {
          yield* removeAuthLeaseAndSecrets(rows, {
            authArtifactId: existingRuntimeAuthArtifact.id,
          });
        }
        yield* rows.authArtifacts.removeByWorkspaceSourceAndActor({
          workspaceId: nextSource.workspaceId,
          sourceId: nextSource.id,
          actorAccountId: options.actorAccountId ?? null,
          slot: "runtime",
        });
      } else {
        yield* rows.authArtifacts.upsert(runtimeAuthArtifact);
        if (
          existingRuntimeAuthArtifact !== null
          && existingRuntimeAuthArtifact.id !== runtimeAuthArtifact.id
        ) {
          yield* removeAuthLeaseAndSecrets(rows, {
            authArtifactId: existingRuntimeAuthArtifact.id,
          });
        }
      }

      yield* cleanupAuthArtifactSecretRefs(rows, {
        previous: existingRuntimeAuthArtifact ?? null,
        next: runtimeAuthArtifact,
      });

      if (importAuthArtifact === null) {
        if (existingImportAuthArtifact !== null) {
          yield* removeAuthLeaseAndSecrets(rows, {
            authArtifactId: existingImportAuthArtifact.id,
          });
        }
        yield* rows.authArtifacts.removeByWorkspaceSourceAndActor({
          workspaceId: nextSource.workspaceId,
          sourceId: nextSource.id,
          actorAccountId: options.actorAccountId ?? null,
          slot: "import",
        });
      } else {
        yield* rows.authArtifacts.upsert(importAuthArtifact);
        if (
          existingImportAuthArtifact !== null
          && existingImportAuthArtifact.id !== importAuthArtifact.id
        ) {
          yield* removeAuthLeaseAndSecrets(rows, {
            authArtifactId: existingImportAuthArtifact.id,
          });
        }
      }

      yield* cleanupAuthArtifactSecretRefs(rows, {
        previous: existingImportAuthArtifact ?? null,
        next: importAuthArtifact,
      });

      const existingSourceState = localWorkspace.workspaceState.sources[nextSource.id];
      const workspaceState: LocalWorkspaceState = {
        ...localWorkspace.workspaceState,
        sources: {
          ...localWorkspace.workspaceState.sources,
          [nextSource.id]: {
            status: nextSource.status,
            lastError: nextSource.lastError,
            sourceHash: nextSource.sourceHash,
            createdAt: existingSourceState?.createdAt ?? nextSource.createdAt,
            updatedAt: nextSource.updatedAt,
          },
        },
      };
      yield* Effect.tryPromise({
        try: () =>
          writeLocalWorkspaceState({
            context: localWorkspace.context,
            state: workspaceState,
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      return yield* loadSourceById(rows, {
        workspaceId: source.workspaceId,
        sourceId: nextSource.id,
        actorAccountId: options.actorAccountId,
      });
    }

    const existing = yield* rows.sources.getByWorkspaceAndId(source.workspaceId, source.id);
    const existingAuthArtifacts = yield* rows.authArtifacts.listByWorkspaceAndSourceId({
      workspaceId: source.workspaceId,
      sourceId: source.id,
    });
    const existingRuntimeAuthArtifact = selectExactAuthArtifact({
      authArtifacts: existingAuthArtifacts,
      actorAccountId: options.actorAccountId,
      slot: "runtime",
    });
    const existingImportAuthArtifact = selectExactAuthArtifact({
      authArtifacts: existingAuthArtifacts,
      actorAccountId: options.actorAccountId,
      slot: "import",
    });

    const nextRecipeId = stableSourceRecipeId(source);
    const nextRecipeRevisionId = Option.isSome(existing) && existing.value.recipeId === nextRecipeId
      ? existing.value.recipeRevisionId
      : stableSourceRecipeRevisionId(source);
    const existingTargetRevision = yield* rows.sourceRecipeRevisions.getById(nextRecipeRevisionId);
    const nextRevision = createSourceRecipeRevisionRecord({
      source,
      recipeId: nextRecipeId,
      recipeRevisionId: nextRecipeRevisionId,
      revisionNumber: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.revisionNumber
        : 1,
      manifestJson: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.manifestJson
        : null,
      manifestHash: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.manifestHash
        : null,
      materializationHash: Option.isSome(existingTargetRevision)
        ? existingTargetRevision.value.materializationHash
        : null,
    });

    const nextRecipe = createSourceRecipeRecord({
      source,
      recipeId: nextRecipeId,
      latestRevisionId: nextRevision.id,
    });

    const { sourceRecord, runtimeAuthArtifact, importAuthArtifact } = splitSourceForStorage({
      source,
      recipeId: nextRecipe.id,
      recipeRevisionId: nextRevision.id,
      actorAccountId: options.actorAccountId,
      existingRuntimeAuthArtifactId: existingRuntimeAuthArtifact?.id ?? null,
      existingImportAuthArtifactId: existingImportAuthArtifact?.id ?? null,
    });

    if (Option.isNone(existing)) {
      yield* rows.sources.insert(sourceRecord);
    } else {
      const {
        id: _id,
        workspaceId: _workspaceId,
        createdAt: _createdAt,
        ...patch
      } = sourceRecord;
      yield* rows.sources.update(source.workspaceId, source.id, patch);
    }

    yield* rows.sourceRecipes.upsert(nextRecipe);
    yield* rows.sourceRecipeRevisions.upsert(nextRevision);

    if (
      Option.isSome(existing)
      && (
        existing.value.recipeId !== nextRecipeId
        || existing.value.recipeRevisionId !== nextRecipeRevisionId
      )
    ) {
      yield* cleanupOrphanedRecipeData(rows, {
        recipeId: existing.value.recipeId,
        recipeRevisionId: existing.value.recipeRevisionId,
      });
    }

    if (runtimeAuthArtifact === null) {
      if (existingRuntimeAuthArtifact !== null) {
        yield* removeAuthLeaseAndSecrets(rows, {
          authArtifactId: existingRuntimeAuthArtifact.id,
        });
      }
      yield* rows.authArtifacts.removeByWorkspaceSourceAndActor({
        workspaceId: source.workspaceId,
        sourceId: source.id,
        actorAccountId: options.actorAccountId ?? null,
        slot: "runtime",
      });
    } else {
      yield* rows.authArtifacts.upsert(runtimeAuthArtifact);
      if (
        existingRuntimeAuthArtifact !== null
        && existingRuntimeAuthArtifact.id !== runtimeAuthArtifact.id
      ) {
        yield* removeAuthLeaseAndSecrets(rows, {
          authArtifactId: existingRuntimeAuthArtifact.id,
        });
      }
    }

    yield* cleanupAuthArtifactSecretRefs(rows, {
      previous: existingRuntimeAuthArtifact ?? null,
      next: runtimeAuthArtifact,
    });

    if (importAuthArtifact === null) {
      if (existingImportAuthArtifact !== null) {
        yield* removeAuthLeaseAndSecrets(rows, {
          authArtifactId: existingImportAuthArtifact.id,
        });
      }
      yield* rows.authArtifacts.removeByWorkspaceSourceAndActor({
        workspaceId: source.workspaceId,
        sourceId: source.id,
        actorAccountId: options.actorAccountId ?? null,
        slot: "import",
      });
    } else {
      yield* rows.authArtifacts.upsert(importAuthArtifact);
      if (
        existingImportAuthArtifact !== null
        && existingImportAuthArtifact.id !== importAuthArtifact.id
      ) {
        yield* removeAuthLeaseAndSecrets(rows, {
          authArtifactId: existingImportAuthArtifact.id,
        });
      }
    }

    yield* cleanupAuthArtifactSecretRefs(rows, {
      previous: existingImportAuthArtifact ?? null,
      next: importAuthArtifact,
    });

    return source;
  });
