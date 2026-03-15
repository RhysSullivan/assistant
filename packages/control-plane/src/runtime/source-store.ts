import type {
  AccountId,
  AuthArtifact,
  CredentialSlot,
  LocalConfigSecretInput,
  LocalConfigSource,
  Source,
  SourceId,
  WorkspaceId,
} from "#schema";
import { SourceIdSchema } from "#schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  stableSourceCatalogId,
  stableSourceCatalogRevisionId,
  splitSourceForStorage,
} from "./source-definitions";
import {
  sourceAuthFromAuthArtifact,
} from "./auth-artifacts";
import {
  type LoadedLocalExecutorConfig,
  type ResolvedLocalWorkspaceContext,
} from "./local-config";
import {
  LocalConfiguredSourceNotFoundError,
  LocalExecutorConfigDecodeError,
  LocalFileSystemError,
  LocalUnsupportedSourceKindError,
  LocalWorkspaceStateDecodeError,
  RuntimeLocalWorkspaceMismatchError,
  RuntimeLocalWorkspaceUnavailableError,
} from "./local-errors";
import {
  requireRuntimeLocalWorkspace,
  RuntimeLocalWorkspaceService,
  type RuntimeLocalWorkspaceState,
} from "./local-runtime-context";
import type {
  SourceArtifactStoreShape,
  WorkspaceStorageServices,
  WorkspaceConfigStoreShape,
  WorkspaceStateStoreShape,
} from "./local-storage";
import {
  SourceArtifactStore,
  WorkspaceConfigStore,
  WorkspaceStateStore,
} from "./local-storage";
import {
  type LocalWorkspaceState,
} from "./local-workspace-state";
import {
  fromConfigSecretProviderId,
  toConfigSecretProviderId,
} from "./local-config-secrets";
import { createDefaultSecretMaterialDeleter } from "./secret-material-providers";
import { authArtifactSecretMaterialRefs } from "./auth-artifacts";
import { removeAuthLeaseAndSecrets } from "./auth-leases";
import { ControlPlaneStore, type ControlPlaneStoreShape } from "./store";
import { getSourceAdapter } from "./source-adapters";
import { refreshWorkspaceSourceTypeDeclarationsInBackground } from "./source-type-declarations";
import { slugify } from "./slug";

const secretRefKey = (ref: { providerId: string; handle: string }): string =>
  `${ref.providerId}:${ref.handle}`;

const cleanupAuthArtifactSecretRefs = (rows: ControlPlaneStoreShape, input: {
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

type RuntimeSourceStoreDeps = {
  rows: ControlPlaneStoreShape;
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState;
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
};

type ResolvedSourceStoreWorkspace = {
  context: ResolvedLocalWorkspaceContext;
  installation: {
    workspaceId: WorkspaceId;
    accountId: AccountId;
  };
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
  loadedConfig: LoadedLocalExecutorConfig;
  workspaceState: LocalWorkspaceState;
};

const resolveLocalConfigSecretProviderAlias = (config: LoadedLocalExecutorConfig["config"]): string | null => {
  const defaultAlias = trimOrNull(config?.secrets?.defaults?.env);
  if (defaultAlias !== null && config?.secrets?.providers?.[defaultAlias]) {
    return defaultAlias;
  }

  return config?.secrets?.providers?.default ? "default" : null;
};

const sourceAuthFromConfigInput = (input: {
  auth: unknown;
  config: LoadedLocalExecutorConfig["config"];
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
      ? (providerAlias === "params" ? "params" : toConfigSecretProviderId(providerAlias))
      : explicit.source === "env"
        ? "env"
        : explicit.source === "params"
          ? "params"
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
  config: LoadedLocalExecutorConfig["config"];
}): LocalConfigSecretInput | undefined => {
  if (input.source.auth.kind !== "bearer") {
    return input.existingConfigAuth;
  }

  if (input.source.auth.token.providerId === "env") {
    return input.source.auth.token.handle;
  }

  if (input.source.auth.token.providerId === "params") {
    return {
      source: "params",
      provider: "params",
      id: input.source.auth.token.handle,
    };
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

const resolveRuntimeLocalWorkspaceFromDeps = (
  deps: RuntimeSourceStoreDeps,
  workspaceId: WorkspaceId,
): Effect.Effect<ResolvedSourceStoreWorkspace,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | Error,
never> =>
  Effect.gen(function* () {
    if (deps.runtimeLocalWorkspace.installation.workspaceId !== workspaceId) {
      return yield* Effect.fail(
        new RuntimeLocalWorkspaceMismatchError({
          message: `Runtime local workspace mismatch: expected ${workspaceId}, got ${deps.runtimeLocalWorkspace.installation.workspaceId}`,
          requestedWorkspaceId: workspaceId,
          activeWorkspaceId: deps.runtimeLocalWorkspace.installation.workspaceId,
        }),
      );
    }

    const loadedConfig = yield* deps.workspaceConfigStore.load(
      deps.runtimeLocalWorkspace.context,
    );
    const workspaceState = yield* deps.workspaceStateStore.load(
      deps.runtimeLocalWorkspace.context,
    );

    return {
      context: deps.runtimeLocalWorkspace.context,
      installation: deps.runtimeLocalWorkspace.installation,
      workspaceConfigStore: deps.workspaceConfigStore,
      workspaceStateStore: deps.workspaceStateStore,
      sourceArtifactStore: deps.sourceArtifactStore,
      loadedConfig,
      workspaceState,
    };
  });

const loadRuntimeSourceStoreDeps = (
  rows: ControlPlaneStoreShape,
  workspaceId: WorkspaceId,
): Effect.Effect<
  RuntimeSourceStoreDeps,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | Error,
  WorkspaceStorageServices
> =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace(workspaceId);
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const sourceArtifactStore = yield* SourceArtifactStore;

    return {
      rows,
      runtimeLocalWorkspace,
      workspaceConfigStore,
      workspaceStateStore,
      sourceArtifactStore,
    };
  });

export const buildLocalSourceRecord = (input: {
  workspaceId: WorkspaceId;
  loadedConfig: LoadedLocalExecutorConfig;
  workspaceState: LocalWorkspaceState;
  sourceId: SourceId;
  actorAccountId?: AccountId | null;
  authArtifacts: ReadonlyArray<AuthArtifact>;
}): Effect.Effect<{
  source: Source;
  sourceId: SourceId;
}, LocalConfiguredSourceNotFoundError | Error, never> =>
  Effect.gen(function* () {
    const sourceConfig = input.loadedConfig.config?.sources?.[input.sourceId];
    if (!sourceConfig) {
      return yield* Effect.fail(
        new LocalConfiguredSourceNotFoundError({
          message: `Configured source not found for id ${input.sourceId}`,
          sourceId: input.sourceId,
        }),
      );
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

    const source: Source = {
      ...baseSource,
      auth:
        runtimeAuthArtifact === null
          ? baseSource.auth
          : sourceAuthFromAuthArtifact(runtimeAuthArtifact),
      importAuth:
        baseSource.importAuthPolicy === "separate"
          ? importAuthArtifact === null
            ? baseSource.importAuth
            : sourceAuthFromAuthArtifact(importAuthArtifact)
          : { kind: "none" },
    };

    return {
      source,
      sourceId: input.sourceId,
    };
  });

const loadSourcesInWorkspaceWithDeps = (
  deps: RuntimeSourceStoreDeps,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<
  readonly Source[],
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | LocalConfiguredSourceNotFoundError
  | Error,
  never
> =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspaceFromDeps(deps, workspaceId);
    const authArtifacts = yield* deps.rows.authArtifacts.listByWorkspaceId(workspaceId);
    const sources = yield* Effect.forEach(
      Object.keys(localWorkspace.loadedConfig.config?.sources ?? {}),
      (sourceId) =>
        Effect.map(
          buildLocalSourceRecord({
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
    yield* Effect.annotateCurrentSpan("executor.source.count", sources.length);
    return sources;
  }).pipe(
    Effect.withSpan("source.store.load_workspace", {
      attributes: {
        "executor.workspace.id": workspaceId,
      },
    }),
  );

const syncWorkspaceSourceTypeDeclarationsWithDeps = (
  deps: RuntimeSourceStoreDeps,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspaceFromDeps(deps, workspaceId);
    const sources = yield* loadSourcesInWorkspaceWithDeps(deps, workspaceId, options);
    const entries = yield* Effect.forEach(sources, (source) =>
      Effect.map(
        deps.sourceArtifactStore.read({
          context: localWorkspace.context,
          sourceId: source.id,
        }),
        (artifact) =>
          artifact === null
            ? null
            : {
                source,
                snapshot: artifact.snapshot,
              },
      )
    );

    yield* Effect.sync(() => {
      refreshWorkspaceSourceTypeDeclarationsInBackground({
        context: localWorkspace.context,
        entries: entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      });
    });
  }).pipe(
    Effect.withSpan("source.types.refresh_workspace.schedule", {
      attributes: {
        "executor.workspace.id": workspaceId,
      },
    }),
  );

const shouldRefreshWorkspaceDeclarationsAfterPersist = (source: Source): boolean =>
  source.enabled === false
  || source.status === "auth_required"
  || source.status === "error"
  || source.status === "draft";

export const loadSourcesInWorkspace = (
  rows: ControlPlaneStoreShape,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<
  readonly Source[],
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | LocalConfiguredSourceNotFoundError
  | Error,
  WorkspaceStorageServices
> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, workspaceId),
    (deps) => loadSourcesInWorkspaceWithDeps(deps, workspaceId, options),
  );

const listLinkedSecretSourcesInWorkspaceWithDeps = (
  deps: RuntimeSourceStoreDeps,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<
  Map<string, Array<{ sourceId: string; sourceName: string }>>,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | LocalConfiguredSourceNotFoundError
  | Error,
  never
> =>
  Effect.gen(function* () {
    const [sources, authArtifacts, materialIds] = yield* Effect.all([
      loadSourcesInWorkspaceWithDeps(deps, workspaceId, {
        actorAccountId: options.actorAccountId,
      }),
      deps.rows.authArtifacts.listByWorkspaceId(workspaceId),
      deps.rows.secretMaterials.listAll().pipe(
        Effect.map((materials) => new Set(materials.map((material) => String(material.id)))),
      ),
    ]);

    const sourceNames = new Map(
      sources.map((source) => [source.id, source.name] as const),
    );
    const linkedSources = new Map<string, Array<{ sourceId: string; sourceName: string }>>();

    for (const artifact of authArtifacts) {
      for (const ref of authArtifactSecretMaterialRefs(artifact)) {
        if (!materialIds.has(ref.handle)) {
          continue;
        }

        const existing = linkedSources.get(ref.handle) ?? [];
        if (!existing.some((link) => link.sourceId === artifact.sourceId)) {
          existing.push({
            sourceId: artifact.sourceId,
            sourceName: sourceNames.get(artifact.sourceId) ?? artifact.sourceId,
          });
          linkedSources.set(ref.handle, existing);
        }
      }
    }

    return linkedSources;
  });

export const listLinkedSecretSourcesInWorkspace = (
  rows: ControlPlaneStoreShape,
  workspaceId: WorkspaceId,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<
  Map<string, Array<{ sourceId: string; sourceName: string }>>,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | LocalConfiguredSourceNotFoundError
  | Error,
  WorkspaceStorageServices
> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, workspaceId),
    (deps) => listLinkedSecretSourcesInWorkspaceWithDeps(deps, workspaceId, options),
  );

const loadSourceByIdWithDeps = (deps: RuntimeSourceStoreDeps, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  actorAccountId?: AccountId | null;
}): Effect.Effect<
  Source,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | LocalConfiguredSourceNotFoundError
  | Error,
  never
> =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspaceFromDeps(deps, input.workspaceId);
    const authArtifacts = yield* deps.rows.authArtifacts.listByWorkspaceId(input.workspaceId);
    if (!localWorkspace.loadedConfig.config?.sources?.[input.sourceId]) {
      return yield* Effect.fail(
        new LocalConfiguredSourceNotFoundError({
          message: `Source not found: workspaceId=${input.workspaceId} sourceId=${input.sourceId}`,
          sourceId: input.sourceId,
        }),
      );
    }

    const localSource = yield* buildLocalSourceRecord({
      workspaceId: input.workspaceId,
      loadedConfig: localWorkspace.loadedConfig,
      workspaceState: localWorkspace.workspaceState,
      sourceId: input.sourceId,
      actorAccountId: input.actorAccountId,
      authArtifacts,
    });

    return localSource.source;
  }).pipe(
    Effect.withSpan("source.store.load_by_id", {
      attributes: {
        "executor.workspace.id": input.workspaceId,
        "executor.source.id": input.sourceId,
      },
    }),
  );

export const loadSourceById = (rows: ControlPlaneStoreShape, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  actorAccountId?: AccountId | null;
}): Effect.Effect<
  Source,
  | RuntimeLocalWorkspaceUnavailableError
  | RuntimeLocalWorkspaceMismatchError
  | LocalFileSystemError
  | LocalExecutorConfigDecodeError
  | LocalWorkspaceStateDecodeError
  | LocalConfiguredSourceNotFoundError
  | Error,
  WorkspaceStorageServices
> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, input.workspaceId),
    (deps) => loadSourceByIdWithDeps(deps, input),
  );

const configSourceFromLocalSource = (input: {
  source: Source;
  existingConfigAuth: LocalConfigSecretInput | undefined;
  config: LoadedLocalExecutorConfig["config"];
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
      throw new LocalUnsupportedSourceKindError({
        message: `Unsupported source kind for local config: ${input.source.kind}`,
        kind: input.source.kind,
      });
  }
};

const removeAuthArtifactsForSource = (rows: ControlPlaneStoreShape, input: {
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

const removeSourceByIdWithDeps = (deps: RuntimeSourceStoreDeps, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}): Effect.Effect<boolean, Error, never> =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspaceFromDeps(deps, input.workspaceId);
    if (!localWorkspace.loadedConfig.config?.sources?.[input.sourceId]) {
      return false;
    }

    const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
    const sources = {
      ...(projectConfig.sources ?? {}),
    };
    delete sources[input.sourceId];
    yield* localWorkspace.workspaceConfigStore.writeProject({
      context: localWorkspace.context,
      config: {
        ...projectConfig,
        sources,
      },
    });

    const {
      [input.sourceId]: _removedSource,
      ...remainingSources
    } = localWorkspace.workspaceState.sources;
    const workspaceState: LocalWorkspaceState = {
      ...localWorkspace.workspaceState,
      sources: remainingSources,
    };
    yield* localWorkspace.workspaceStateStore.write({
      context: localWorkspace.context,
      state: workspaceState,
    });
    yield* localWorkspace.sourceArtifactStore.remove({
      context: localWorkspace.context,
      sourceId: input.sourceId,
    });

    yield* deps.rows.sourceAuthSessions.removeByWorkspaceAndSourceId(
      input.workspaceId,
      input.sourceId,
    );
    yield* deps.rows.sourceOauthClients.removeByWorkspaceAndSourceId({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });
    yield* removeAuthArtifactsForSource(deps.rows, input);
    yield* syncWorkspaceSourceTypeDeclarationsWithDeps(deps, input.workspaceId);

    return true;
  });

export const removeSourceById = (rows: ControlPlaneStoreShape, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
}): Effect.Effect<boolean, Error, WorkspaceStorageServices> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, input.workspaceId),
    (deps) => removeSourceByIdWithDeps(deps, input),
  );

const persistSourceWithDeps = (
  deps: RuntimeSourceStoreDeps,
  source: Source,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<Source, Error, never> =>
  Effect.gen(function* () {
    const localWorkspace = yield* resolveRuntimeLocalWorkspaceFromDeps(deps, source.workspaceId);
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
    const existingAuthArtifacts = yield* deps.rows.authArtifacts.listByWorkspaceAndSourceId({
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
    yield* localWorkspace.workspaceConfigStore.writeProject({
      context: localWorkspace.context,
      config: {
        ...projectConfig,
        sources,
      },
    });

    const { runtimeAuthArtifact, importAuthArtifact } = splitSourceForStorage({
      source: nextSource,
      catalogId: stableSourceCatalogId(nextSource),
      catalogRevisionId: stableSourceCatalogRevisionId(nextSource),
      actorAccountId: options.actorAccountId,
      existingRuntimeAuthArtifactId: existingRuntimeAuthArtifact?.id ?? null,
      existingImportAuthArtifactId: existingImportAuthArtifact?.id ?? null,
    });

    if (runtimeAuthArtifact === null) {
      if (existingRuntimeAuthArtifact !== null) {
        yield* removeAuthLeaseAndSecrets(deps.rows, {
          authArtifactId: existingRuntimeAuthArtifact.id,
        });
      }
      yield* deps.rows.authArtifacts.removeByWorkspaceSourceAndActor({
        workspaceId: nextSource.workspaceId,
        sourceId: nextSource.id,
        actorAccountId: options.actorAccountId ?? null,
        slot: "runtime",
      });
    } else {
      yield* deps.rows.authArtifacts.upsert(runtimeAuthArtifact);
      if (
        existingRuntimeAuthArtifact !== null
        && existingRuntimeAuthArtifact.id !== runtimeAuthArtifact.id
      ) {
        yield* removeAuthLeaseAndSecrets(deps.rows, {
          authArtifactId: existingRuntimeAuthArtifact.id,
        });
      }
    }

    yield* cleanupAuthArtifactSecretRefs(deps.rows, {
      previous: existingRuntimeAuthArtifact ?? null,
      next: runtimeAuthArtifact,
    });

    if (importAuthArtifact === null) {
      if (existingImportAuthArtifact !== null) {
        yield* removeAuthLeaseAndSecrets(deps.rows, {
          authArtifactId: existingImportAuthArtifact.id,
        });
      }
      yield* deps.rows.authArtifacts.removeByWorkspaceSourceAndActor({
        workspaceId: nextSource.workspaceId,
        sourceId: nextSource.id,
        actorAccountId: options.actorAccountId ?? null,
        slot: "import",
      });
    } else {
      yield* deps.rows.authArtifacts.upsert(importAuthArtifact);
      if (
        existingImportAuthArtifact !== null
        && existingImportAuthArtifact.id !== importAuthArtifact.id
      ) {
        yield* removeAuthLeaseAndSecrets(deps.rows, {
          authArtifactId: existingImportAuthArtifact.id,
        });
      }
    }

    yield* cleanupAuthArtifactSecretRefs(deps.rows, {
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
    yield* localWorkspace.workspaceStateStore.write({
      context: localWorkspace.context,
      state: workspaceState,
    });

    if (shouldRefreshWorkspaceDeclarationsAfterPersist(nextSource)) {
      yield* syncWorkspaceSourceTypeDeclarationsWithDeps(
        deps,
        nextSource.workspaceId,
        options,
      );
    }

    return yield* loadSourceByIdWithDeps(deps, {
      workspaceId: nextSource.workspaceId,
      sourceId: nextSource.id,
      actorAccountId: options.actorAccountId,
    });
  }).pipe(
    Effect.withSpan("source.store.persist", {
      attributes: {
        "executor.workspace.id": source.workspaceId,
        "executor.source.id": source.id,
        "executor.source.kind": source.kind,
        "executor.source.status": source.status,
      },
    }),
  );

export const persistSource = (
  rows: ControlPlaneStoreShape,
  source: Source,
  options: {
    actorAccountId?: AccountId | null;
  } = {},
): Effect.Effect<Source, Error, WorkspaceStorageServices> =>
  Effect.flatMap(
    loadRuntimeSourceStoreDeps(rows, source.workspaceId),
    (deps) => persistSourceWithDeps(deps, source, options),
  );

type RuntimeSourceStoreShape = {
  loadSourcesInWorkspace: (
    workspaceId: WorkspaceId,
    options?: { actorAccountId?: AccountId | null },
  ) => ReturnType<typeof loadSourcesInWorkspaceWithDeps>;
  listLinkedSecretSourcesInWorkspace: (
    workspaceId: WorkspaceId,
    options?: { actorAccountId?: AccountId | null },
  ) => ReturnType<typeof listLinkedSecretSourcesInWorkspaceWithDeps>;
  loadSourceById: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
    actorAccountId?: AccountId | null;
  }) => ReturnType<typeof loadSourceByIdWithDeps>;
  removeSourceById: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
  }) => ReturnType<typeof removeSourceByIdWithDeps>;
  persistSource: (
    source: Source,
    options?: { actorAccountId?: AccountId | null },
  ) => ReturnType<typeof persistSourceWithDeps>;
};

export type RuntimeSourceStore = RuntimeSourceStoreShape;

export class RuntimeSourceStoreService extends Context.Tag(
  "#runtime/RuntimeSourceStoreService",
)<RuntimeSourceStoreService, RuntimeSourceStoreShape>() {}

export const RuntimeSourceStoreLive = Layer.effect(
  RuntimeSourceStoreService,
  Effect.gen(function* () {
    const rows = yield* ControlPlaneStore;
    const runtimeLocalWorkspace = yield* RuntimeLocalWorkspaceService;
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const sourceArtifactStore = yield* SourceArtifactStore;

    const deps: RuntimeSourceStoreDeps = {
      rows,
      runtimeLocalWorkspace,
      workspaceConfigStore,
      workspaceStateStore,
      sourceArtifactStore,
    };

    return RuntimeSourceStoreService.of({
      loadSourcesInWorkspace: (workspaceId, options = {}) =>
        loadSourcesInWorkspaceWithDeps(deps, workspaceId, options),
      listLinkedSecretSourcesInWorkspace: (workspaceId, options = {}) =>
        listLinkedSecretSourcesInWorkspaceWithDeps(deps, workspaceId, options),
      loadSourceById: (input) =>
        loadSourceByIdWithDeps(deps, input),
      removeSourceById: (input) =>
        removeSourceByIdWithDeps(deps, input),
      persistSource: (source, options = {}) =>
        persistSourceWithDeps(deps, source, options),
    });
  }),
);
