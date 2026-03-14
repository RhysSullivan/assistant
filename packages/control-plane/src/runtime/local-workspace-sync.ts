import { type Policy } from "#schema";
import * as Effect from "effect/Effect";

import {
  type LoadedLocalExecutorConfig,
  type ResolvedLocalWorkspaceContext,
} from "./local-config";
import {
  loadLocalWorkspaceState,
  writeLocalWorkspaceState,
  type LocalWorkspaceState,
} from "./local-workspace-state";
import { slugify } from "./slug";

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

const pruneLocalWorkspaceState = (input: {
  context: ResolvedLocalWorkspaceContext;
  loadedConfig: LoadedLocalExecutorConfig;
}): Effect.Effect<LocalWorkspaceState, Error, never> =>
  Effect.gen(function* () {
    const currentState = yield* Effect.tryPromise({
      try: () => loadLocalWorkspaceState(input.context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    const configuredSourceIds = new Set(
      Object.keys(input.loadedConfig.config?.sources ?? {}),
    );
    const configuredPolicyKeys = new Set(
      Object.keys(input.loadedConfig.config?.policies ?? {}),
    );

    const nextState: LocalWorkspaceState = {
      ...currentState,
      sources: Object.fromEntries(
        Object.entries(currentState.sources).filter(([sourceId]) =>
          configuredSourceIds.has(sourceId)
        ),
      ),
      policies: Object.fromEntries(
        Object.entries(currentState.policies).filter(([policyKey]) =>
          configuredPolicyKeys.has(policyKey)
        ),
      ),
    };

    if (JSON.stringify(nextState) === JSON.stringify(currentState)) {
      return currentState;
    }

    yield* Effect.tryPromise({
      try: () =>
        writeLocalWorkspaceState({
          context: input.context,
          state: nextState,
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    return nextState;
  });

export const synchronizeLocalWorkspaceState = (input: {
  context: ResolvedLocalWorkspaceContext;
  loadedConfig: LoadedLocalExecutorConfig;
}): Effect.Effect<LoadedLocalExecutorConfig["config"], Error, never> =>
  Effect.gen(function* () {
    yield* pruneLocalWorkspaceState({
      context: input.context,
      loadedConfig: input.loadedConfig,
    });

    return input.loadedConfig.config;
  });
