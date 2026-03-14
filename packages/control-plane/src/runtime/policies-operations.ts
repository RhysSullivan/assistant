import { createHash } from "node:crypto";

import type {
  CreatePolicyPayload,
  UpdatePolicyPayload,
} from "../api/policies/api";
import {
  PolicyIdSchema,
  type LocalExecutorConfig,
  type Policy,
  type PolicyId,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";

import {
  loadLocalExecutorConfig,
  writeProjectLocalExecutorConfig,
} from "./local-config";
import {
  requireRuntimeLocalWorkspace,
} from "./local-runtime-context";
import {
  loadLocalWorkspaceState,
  writeLocalWorkspaceState,
} from "./local-workspace-state";
import {
  derivePolicyConfigKey,
} from "./local-workspace-sync";
import {
  type OperationErrors,
  operationErrors,
} from "./operation-errors";
const policyOps = {
  list: operationErrors("policies.list"),
  create: operationErrors("policies.create"),
  get: operationErrors("policies.get"),
  update: operationErrors("policies.update"),
  remove: operationErrors("policies.remove"),
} as const;

type PolicyScopeContext = {
  scopeType: Policy["scopeType"];
  organizationId: Policy["organizationId"];
  workspaceId: Policy["workspaceId"];
};

const cloneJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const localPolicyIdForConfigKey = (input: {
  workspaceRoot: string;
  configKey: string;
}): Policy["id"] =>
  PolicyIdSchema.make(
    `pol_local_${createHash("sha256").update(`${input.workspaceRoot}:${input.configKey}`).digest("hex").slice(0, 16)}`,
  );

const ensureLocalWorkspacePolicyCompatible = (
  operation: OperationErrors,
  payload: CreatePolicyPayload | UpdatePolicyPayload,
) =>
  Effect.gen(function* () {
    if (payload.targetAccountId !== undefined && payload.targetAccountId !== null) {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "targetAccountId is not supported in .executor/executor.jsonc policies",
        ),
      );
    }
    if (payload.clientId !== undefined && payload.clientId !== null) {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "clientId is not supported in .executor/executor.jsonc policies",
        ),
      );
    }
    if (payload.argumentConditionsJson !== undefined && payload.argumentConditionsJson !== null) {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "argumentConditionsJson is not supported in .executor/executor.jsonc policies",
        ),
      );
    }
    if (payload.resourceType !== undefined && payload.resourceType !== "tool_path") {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "Only tool_path workspace policies are supported in local config",
        ),
      );
    }
    if (payload.matchType !== undefined && payload.matchType !== "glob") {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "Only glob workspace policies are supported in local config",
        ),
      );
    }
  });

export const loadRuntimeLocalWorkspacePolicies = (workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace(workspaceId);
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

    const configEntries = Object.entries(loadedConfig.config?.policies ?? {});
    const policies = configEntries.map(([configKey, configPolicy]) => {
      const state = workspaceState.policies[configKey];
      return {
        id: state?.id ?? localPolicyIdForConfigKey({
          workspaceRoot: runtimeLocalWorkspace.context.workspaceRoot,
          configKey,
        }),
        configKey,
        scopeType: "workspace" as const,
        organizationId: runtimeLocalWorkspace.installation.organizationId,
        workspaceId,
        targetAccountId: null,
        clientId: null,
        resourceType: "tool_path" as const,
        resourcePattern: configPolicy.match.trim(),
        matchType: "glob" as const,
        effect: configPolicy.action,
        approvalMode: configPolicy.approval === "manual" ? "required" as const : "auto" as const,
        argumentConditionsJson: null,
        priority: configPolicy.priority ?? 0,
        enabled: configPolicy.enabled ?? true,
        createdAt: state?.createdAt ?? Date.now(),
        updatedAt: state?.updatedAt ?? Date.now(),
      } satisfies Policy;
    });

    return {
      runtimeLocalWorkspace,
      loadedConfig,
      workspaceState,
      policies,
    };
  });

const loadWorkspacePolicyContext = (
  operation: OperationErrors,
  workspaceId: WorkspaceId,
) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace(workspaceId).pipe(
      Effect.mapError((cause) =>
        operation.notFound(
          "Workspace not found",
          cause instanceof Error ? cause.message : String(cause),
        ),
      ),
    );

    return {
      scopeType: "workspace",
      organizationId: runtimeLocalWorkspace.installation.organizationId,
      workspaceId,
    } satisfies PolicyScopeContext;
  });

const policyMatchesScope = (policy: Policy, scope: PolicyScopeContext): boolean =>
  policy.scopeType === scope.scopeType
  && policy.organizationId === scope.organizationId
  && policy.workspaceId === scope.workspaceId;

const writeLocalPolicyFiles = (input: {
  operation: OperationErrors;
  context: Parameters<typeof writeProjectLocalExecutorConfig>[0]["context"];
  projectConfig: LocalExecutorConfig;
  workspaceState: Awaited<ReturnType<typeof loadLocalWorkspaceState>>;
}) =>
  Effect.tryPromise({
    try: () =>
      Promise.all([
        writeProjectLocalExecutorConfig({
          context: input.context,
          config: input.projectConfig,
        }),
        writeLocalWorkspaceState({
          context: input.context,
          state: input.workspaceState,
        }),
      ]).then(() => undefined),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(
    Effect.mapError((cause) =>
      input.operation.unknownStorage(
        cause,
        "Failed writing local workspace policy files",
      ),
    ),
  );

export const listPolicies = (workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    yield* loadWorkspacePolicyContext(policyOps.list, workspaceId);
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.list.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    return localWorkspace.policies;
  });

export const createPolicy = (input: {
  workspaceId: WorkspaceId;
  payload: CreatePolicyPayload;
}) =>
  Effect.gen(function* () {
    const scope = yield* loadWorkspacePolicyContext(policyOps.create, input.workspaceId);
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.create.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    yield* ensureLocalWorkspacePolicyCompatible(policyOps.create, input.payload);

    const now = Date.now();
    const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
    const policies = {
      ...(projectConfig.policies ?? {}),
    };
    const configKey = derivePolicyConfigKey({
      configKey: null,
      resourcePattern: input.payload.resourcePattern ?? "*",
      effect: input.payload.effect ?? "allow",
      approvalMode: input.payload.approvalMode ?? "auto",
    }, new Set(Object.keys(policies)));
    const id = localWorkspace.workspaceState.policies[configKey]?.id
      ?? localPolicyIdForConfigKey({
        workspaceRoot: localWorkspace.runtimeLocalWorkspace.context.workspaceRoot,
        configKey,
      });

    policies[configKey] = {
      match: input.payload.resourcePattern ?? "*",
      action: input.payload.effect ?? "allow",
      approval: (input.payload.approvalMode ?? "auto") === "required" ? "manual" : "auto",
      ...(input.payload.enabled === false ? { enabled: false } : {}),
      ...((input.payload.priority ?? 0) !== 0 ? { priority: input.payload.priority ?? 0 } : {}),
    };

    const existingState = localWorkspace.workspaceState.policies[configKey];
    const workspaceState = {
      ...localWorkspace.workspaceState,
      policies: {
        ...localWorkspace.workspaceState.policies,
        [configKey]: {
          id,
          createdAt: existingState?.createdAt ?? now,
          updatedAt: now,
        },
      },
    };
    yield* writeLocalPolicyFiles({
      operation: policyOps.create,
      context: localWorkspace.runtimeLocalWorkspace.context,
      projectConfig: {
        ...projectConfig,
        policies,
      },
      workspaceState,
    });

    return {
      id,
      configKey,
      scopeType: "workspace",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      targetAccountId: null,
      clientId: null,
      resourceType: "tool_path",
      resourcePattern: policies[configKey]!.match,
      matchType: "glob",
      effect: policies[configKey]!.action,
      approvalMode: policies[configKey]!.approval === "manual" ? "required" : "auto",
      argumentConditionsJson: null,
      priority: policies[configKey]!.priority ?? 0,
      enabled: policies[configKey]!.enabled ?? true,
      createdAt: workspaceState.policies[configKey]!.createdAt,
      updatedAt: now,
    } satisfies Policy;
  });

export const getPolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
}) =>
  Effect.gen(function* () {
    const scope = yield* loadWorkspacePolicyContext(policyOps.get, input.workspaceId);
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.get.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    const policy = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
    if (policy === null || !policyMatchesScope(policy, scope)) {
      return yield* Effect.fail(
        policyOps.get.notFound(
          "Policy not found",
          `scopeType=${scope.scopeType} organizationId=${scope.organizationId} workspaceId=${scope.workspaceId} policyId=${input.policyId}`,
        ),
      );
    }
    return policy;
  });

export const updatePolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
  payload: UpdatePolicyPayload;
}) =>
  Effect.gen(function* () {
    const scope = yield* loadWorkspacePolicyContext(policyOps.update, input.workspaceId);
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.update.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    yield* ensureLocalWorkspacePolicyCompatible(policyOps.update, input.payload);
    const existing = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
    if (existing === null || existing.configKey === null || !policyMatchesScope(existing, scope)) {
      return yield* Effect.fail(
        policyOps.update.notFound(
          "Policy not found",
          `scopeType=${scope.scopeType} organizationId=${scope.organizationId} workspaceId=${scope.workspaceId} policyId=${input.policyId}`,
        ),
      );
    }

    const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
    const policies = {
      ...(projectConfig.policies ?? {}),
    };
    const existingConfig = policies[existing.configKey] ?? {
      match: existing.resourcePattern,
      action: existing.effect,
      approval: existing.approvalMode === "required" ? "manual" : "auto",
    };
    policies[existing.configKey] = {
      ...existingConfig,
      ...(input.payload.resourcePattern !== undefined ? { match: input.payload.resourcePattern } : {}),
      ...(input.payload.effect !== undefined ? { action: input.payload.effect } : {}),
      ...(input.payload.approvalMode !== undefined
        ? { approval: input.payload.approvalMode === "required" ? "manual" : "auto" }
        : {}),
      ...(input.payload.enabled !== undefined ? { enabled: input.payload.enabled } : {}),
      ...(input.payload.priority !== undefined ? { priority: input.payload.priority } : {}),
    };

    const updatedAt = Date.now();
    const existingState = localWorkspace.workspaceState.policies[existing.configKey];
    const workspaceState = {
      ...localWorkspace.workspaceState,
      policies: {
        ...localWorkspace.workspaceState.policies,
        [existing.configKey]: {
          id: existing.id,
          createdAt: existingState?.createdAt ?? existing.createdAt,
          updatedAt,
        },
      },
    };
    yield* writeLocalPolicyFiles({
      operation: policyOps.update,
      context: localWorkspace.runtimeLocalWorkspace.context,
      projectConfig: {
        ...projectConfig,
        policies,
      },
      workspaceState,
    });

    return {
      ...existing,
      resourcePattern: policies[existing.configKey]!.match,
      effect: policies[existing.configKey]!.action,
      approvalMode: policies[existing.configKey]!.approval === "manual" ? "required" : "auto",
      priority: policies[existing.configKey]!.priority ?? 0,
      enabled: policies[existing.configKey]!.enabled ?? true,
      updatedAt,
    } satisfies Policy;
  });

export const removePolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
}) =>
  Effect.gen(function* () {
    const scope = yield* loadWorkspacePolicyContext(policyOps.remove, input.workspaceId);
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.remove.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    const existing = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
    if (existing === null || existing.configKey === null || !policyMatchesScope(existing, scope)) {
      return { removed: false };
    }

    const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
    const policies = {
      ...(projectConfig.policies ?? {}),
    };
    delete policies[existing.configKey];
    const {
      [existing.configKey]: _removedPolicy,
      ...remainingPolicies
    } = localWorkspace.workspaceState.policies;
    yield* writeLocalPolicyFiles({
      operation: policyOps.remove,
      context: localWorkspace.runtimeLocalWorkspace.context,
      projectConfig: {
        ...projectConfig,
        policies,
      },
      workspaceState: {
        ...localWorkspace.workspaceState,
        policies: remainingPolicies,
      },
    });
    return { removed: true };
  });
