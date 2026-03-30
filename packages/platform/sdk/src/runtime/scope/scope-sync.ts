import * as Effect from "effect/Effect";

import {
  type LoadedExecutorScopeConfig,
} from "../scope-config";
import {
  ScopeStateStore,
} from "./storage";
import {
  type LocalScopeState,
} from "../scope-state";

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const derivePolicyConfigKey = (
  policy: {
    resourcePattern: string;
    effect: "allow" | "deny";
    approvalMode: "auto" | "required";
  },
  used: Set<string>,
): string => {
  const base =
    trimOrNull(policy.resourcePattern)
    ?? `${policy.effect}-${policy.approvalMode}`;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
};

const pruneLocalWorkspaceState = (input: {
  loadedConfig: LoadedExecutorScopeConfig;
}): Effect.Effect<LocalScopeState, Error, ScopeStateStore> =>
  Effect.gen(function* () {
    const scopeStateStore = yield* ScopeStateStore;
    const currentState = yield* scopeStateStore.load();

    const configuredSourceIds = new Set(
      Object.keys(input.loadedConfig.config?.sources ?? {}),
    );
    const configuredPolicyKeys = new Set(
      Object.keys(input.loadedConfig.config?.policies ?? {}),
    );

    const nextState: LocalScopeState = {
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

    yield* scopeStateStore.write({
      state: nextState,
    });

    return nextState;
  });

export const synchronizeLocalScopeState = (input: {
  loadedConfig: LoadedExecutorScopeConfig;
}): Effect.Effect<LoadedExecutorScopeConfig["config"], Error, ScopeStateStore> =>
  Effect.gen(function* () {
    yield* pruneLocalWorkspaceState({
      loadedConfig: input.loadedConfig,
    });

    return input.loadedConfig.config;
  });
