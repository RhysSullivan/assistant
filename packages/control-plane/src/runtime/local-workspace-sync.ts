import type { SqlControlPlaneRows } from "#persistence";
import {
  type AccountId,
  type LocalConfigPolicy,
  type LocalConfigSource,
  type LocalExecutorConfig,
  type Policy,
  type Source,
  type Workspace,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  defaultWorkspaceDisplayName,
  type LoadedLocalExecutorConfig,
  mergeLocalExecutorConfigs,
  type ResolvedLocalWorkspaceContext,
  writeProjectLocalExecutorConfig,
} from "./local-config";
import {
  buildLocalSourceArtifact,
  writeLocalSourceArtifact,
} from "./local-source-artifacts";
import {
  loadLocalWorkspaceState,
  writeLocalWorkspaceState,
  type LocalWorkspaceState,
} from "./local-workspace-state";
import { slugify } from "./slug";
import { loadSourcesInWorkspace } from "./source-store";

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toApprovalMode = (approval: LocalConfigPolicy["approval"]): Policy["approvalMode"] =>
  approval === "manual" ? "required" : "auto";

export const deriveSourceConfigKey = (
  source: Pick<Source, "namespace" | "name">,
  used: Set<string>,
): string => {
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
  used.add(candidate);
  return candidate;
};

export const derivePolicyConfigKey = (
  policy: Pick<Policy, "configKey" | "resourcePattern" | "effect" | "approvalMode">,
  used: Set<string>,
): string => {
  const base =
    trimOrNull(policy.configKey)
    ?? trimOrNull(policy.resourcePattern)
    ?? `${policy.effect}-${policy.approvalMode}`;
  const slugBase = slugify(base) || "policy";
  let candidate = slugBase;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${slugBase}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
};

const configAuthFromStoredSource = (input: {
  source: Source;
  config: LocalExecutorConfig | null;
}) => {
  const auth = input.source.auth;
  if (auth.kind !== "bearer") {
    return undefined;
  }

  if (auth.token.providerId === "env") {
    return auth.token.handle;
  }

  const providers = input.config?.secrets?.providers ?? {};
  const providerEntry = Object.entries(providers).find(
    ([providerAlias]) =>
      `config:${providerAlias}` === auth.token.providerId,
  );
  if (!providerEntry) {
    return undefined;
  }

  const [provider, definition] = providerEntry;
  return {
    source: definition.source,
    provider,
    id: auth.token.handle,
  } as const;
};

export const configSourceFromStoredSource = (input: {
  source: Source;
  sourceId: string;
  config: LocalExecutorConfig | null;
}): LocalConfigSource => {
  const auth = configAuthFromStoredSource(input);
  const common = {
    ...(trimOrNull(input.source.name) !== trimOrNull(input.sourceId)
      ? { name: input.source.name }
      : {}),
    ...(trimOrNull(input.source.namespace) !== trimOrNull(input.sourceId)
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
        binding: input.source.binding as Extract<LocalConfigSource, { kind: "openapi" }>["binding"],
      };
    case "graphql":
      return {
        kind: "graphql",
        ...common,
        binding: input.source.binding as Extract<LocalConfigSource, { kind: "graphql" }>["binding"],
      };
    case "google_discovery":
      return {
        kind: "google_discovery",
        ...common,
        binding: input.source.binding as Extract<LocalConfigSource, { kind: "google_discovery" }>["binding"],
      };
    case "mcp":
      return {
        kind: "mcp",
        ...common,
        binding: input.source.binding as Extract<LocalConfigSource, { kind: "mcp" }>["binding"],
      };
    default:
      throw new Error(`Unsupported source kind for config export: ${input.source.kind}`);
  }
};

export const configPolicyFromStoredPolicy = (policy: Policy): LocalConfigPolicy => ({
  match: policy.resourcePattern,
  action: policy.effect,
  approval: policy.approvalMode === "required" ? "manual" : "auto",
  ...(policy.enabled === false ? { enabled: false } : {}),
  ...(policy.priority !== 0 ? { priority: policy.priority } : {}),
});

const ensureWorkspaceMetadata = (input: {
  rows: SqlControlPlaneRows;
  installation: {
    workspaceId: Workspace["id"];
  };
  context: ResolvedLocalWorkspaceContext;
  config: LocalExecutorConfig | null;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const workspace = yield* input.rows.workspaces.getById(input.installation.workspaceId);
    if (Option.isNone(workspace)) {
      return;
    }

    const desiredName =
      trimOrNull(input.config?.workspace?.name)
      ?? defaultWorkspaceDisplayName(input.context);
    if (workspace.value.name === desiredName) {
      return;
    }

    yield* input.rows.workspaces.update(workspace.value.id, {
      name: desiredName,
      updatedAt: Date.now(),
    });
  });

const exportWorkspaceConfig = (input: {
  rows: SqlControlPlaneRows;
  context: ResolvedLocalWorkspaceContext;
  loadedConfig: LoadedLocalExecutorConfig;
  installation: {
    workspaceId: Workspace["id"];
    accountId: AccountId;
  };
}): Effect.Effect<LocalExecutorConfig | null, Error, never> =>
  Effect.gen(function* () {
    if (input.loadedConfig.projectConfig !== null) {
      return input.loadedConfig.projectConfig;
    }

    const sourceRecords = yield* input.rows.sources.listByWorkspaceId(input.installation.workspaceId);
    const sources = yield* loadSourcesInWorkspace(
      input.rows,
      input.installation.workspaceId,
      { actorAccountId: input.installation.accountId },
    );
    const policies = yield* input.rows.policies.listByWorkspaceId(input.installation.workspaceId);

    if (sources.length === 0 && policies.length === 0) {
      return null;
    }

    const sourceKeys = new Set<string>();
    const policyKeys = new Set<string>();
    const sourceMappings: Array<{ configKey: string; source: Source }> = [];
    const policyMappings: Array<{ configKey: string; policy: Policy }> = [];
    const sourcesConfig: Record<string, LocalConfigSource> = {};
    const policiesConfig: Record<string, LocalConfigPolicy> = {};

    for (const source of sources) {
      const configKey = deriveSourceConfigKey(source, sourceKeys);
      sourceMappings.push({ configKey, source });
      sourcesConfig[configKey] = configSourceFromStoredSource({
        source,
        sourceId: configKey,
        config: input.loadedConfig.config,
      });
    }

    for (const policy of policies) {
      const configKey = derivePolicyConfigKey(policy, policyKeys);
      policyMappings.push({ configKey, policy });
      policiesConfig[configKey] = configPolicyFromStoredPolicy({
        ...policy,
        configKey,
      });
    }

    const projectConfig = {
      ...(Object.keys(sourcesConfig).length > 0 ? { sources: sourcesConfig } : {}),
      ...(Object.keys(policiesConfig).length > 0 ? { policies: policiesConfig } : {}),
    } satisfies LocalExecutorConfig;

    yield* Effect.tryPromise({
      try: () =>
        writeProjectLocalExecutorConfig({
          context: input.context,
          config: projectConfig,
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    const sourceRecordById = new Map(sourceRecords.map((sourceRecord) => [sourceRecord.id, sourceRecord]));
    const revisionIds = [...new Set(sourceRecords.map((sourceRecord) => sourceRecord.recipeRevisionId))];
    const [revisions, documents, schemaBundles, operations] = yield* Effect.all([
      input.rows.sourceRecipeRevisions.listByIds(revisionIds),
      input.rows.sourceRecipeDocuments.listByRevisionIds(revisionIds),
      input.rows.sourceRecipeSchemaBundles.listByRevisionIds(revisionIds),
      input.rows.sourceRecipeOperations.listByRevisionIds(revisionIds),
    ]);
    const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
    const documentsByRevisionId = new Map<string, typeof documents>();
    const schemaBundlesByRevisionId = new Map<string, typeof schemaBundles>();
    const operationsByRevisionId = new Map<string, typeof operations>();

    for (const document of documents) {
      const existing = documentsByRevisionId.get(document.recipeRevisionId) ?? [];
      existing.push(document);
      documentsByRevisionId.set(document.recipeRevisionId, existing);
    }
    for (const schemaBundle of schemaBundles) {
      const existing = schemaBundlesByRevisionId.get(schemaBundle.recipeRevisionId) ?? [];
      existing.push(schemaBundle);
      schemaBundlesByRevisionId.set(schemaBundle.recipeRevisionId, existing);
    }
    for (const operation of operations) {
      const existing = operationsByRevisionId.get(operation.recipeRevisionId) ?? [];
      existing.push(operation);
      operationsByRevisionId.set(operation.recipeRevisionId, existing);
    }

    let workspaceState: LocalWorkspaceState = yield* Effect.tryPromise({
      try: () => loadLocalWorkspaceState(input.context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    for (const { configKey, source } of sourceMappings) {
      workspaceState = {
        ...workspaceState,
        sources: {
          ...workspaceState.sources,
          [configKey]: {
            status: source.status,
            lastError: source.lastError,
            sourceHash: source.sourceHash,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
          },
        },
      };

      const sourceRecord = sourceRecordById.get(source.id);
      const revision = sourceRecord ? revisionById.get(sourceRecord.recipeRevisionId) : null;
      if (!sourceRecord || !revision) {
        continue;
      }

      yield* Effect.tryPromise({
        try: () =>
          writeLocalSourceArtifact({
            context: input.context,
            sourceId: configKey,
            artifact: buildLocalSourceArtifact({
              source: {
                ...source,
                id: configKey as Source["id"],
                sourceHash: revision.manifestHash ?? source.sourceHash,
              },
              materialization: {
                manifestJson: revision.manifestJson,
                manifestHash: revision.manifestHash,
                sourceHash: revision.manifestHash ?? source.sourceHash,
                documents: documentsByRevisionId.get(revision.id) ?? [],
                schemaBundles: schemaBundlesByRevisionId.get(revision.id) ?? [],
                operations: operationsByRevisionId.get(revision.id) ?? [],
              },
            }),
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
    }

    for (const { configKey, policy } of policyMappings) {
      workspaceState = {
        ...workspaceState,
        policies: {
          ...workspaceState.policies,
          [configKey]: {
            id: policy.id,
            createdAt: policy.createdAt,
            updatedAt: policy.updatedAt,
          },
        },
      };
    }

    yield* Effect.tryPromise({
      try: () =>
        writeLocalWorkspaceState({
          context: input.context,
          state: workspaceState,
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    return projectConfig;
  });

export const synchronizeLocalWorkspaceState = (input: {
  rows: SqlControlPlaneRows;
  context: ResolvedLocalWorkspaceContext;
  loadedConfig: LoadedLocalExecutorConfig;
  installation: {
    workspaceId: Workspace["id"];
    accountId: AccountId;
  };
}): Effect.Effect<LocalExecutorConfig | null, Error, never> =>
  Effect.gen(function* () {
    const exportedProjectConfig = yield* exportWorkspaceConfig(input);
    const effectiveConfig =
      exportedProjectConfig === null
        ? input.loadedConfig.config
        : mergeLocalExecutorConfigs(input.loadedConfig.homeConfig, exportedProjectConfig);

    yield* ensureWorkspaceMetadata({
      rows: input.rows,
      installation: input.installation,
      context: input.context,
      config: effectiveConfig,
    });

    return effectiveConfig ?? null;
  });
