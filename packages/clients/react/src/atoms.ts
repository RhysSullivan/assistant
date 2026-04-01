import type { ScopeId, ToolId, SecretId } from "@executor/sdk";
import { ScopeId as ScopeIdSchema } from "@executor/sdk";

import { ExecutorApiClient } from "./client";

// ---------------------------------------------------------------------------
// Query atoms — typed, cached, reactive
// ---------------------------------------------------------------------------

const DEFAULT_SCOPE = ScopeIdSchema.make("default");

export const toolsAtom = (scopeId: ScopeId = DEFAULT_SCOPE) =>
  ExecutorApiClient.query("tools", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
  });

export const toolSchemaAtom = (scopeId: ScopeId, toolId: ToolId) =>
  ExecutorApiClient.query("tools", "schema", {
    path: { scopeId, toolId },
    timeToLive: "1 minute",
  });

export const secretsAtom = (scopeId: ScopeId = DEFAULT_SCOPE) =>
  ExecutorApiClient.query("secrets", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
  });

export const secretStatusAtom = (scopeId: ScopeId, secretId: SecretId) =>
  ExecutorApiClient.query("secrets", "status", {
    path: { scopeId, secretId },
    timeToLive: "15 seconds",
  });

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const invokeTool = ExecutorApiClient.mutation("tools", "invoke");

export const setSecret = ExecutorApiClient.mutation("secrets", "set");

export const removeSecret = ExecutorApiClient.mutation("secrets", "remove");

export const removeSource = ExecutorApiClient.mutation("tools", "removeSource");

export const refreshSource = ExecutorApiClient.mutation("tools", "refreshSource");
