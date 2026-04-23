import type { ScopeId } from "@executor/sdk";
import { ReactivityKey } from "@executor/react/api/reactivity-keys";
import { OpenApiClient } from "./client";

// ---------------------------------------------------------------------------
// Query atoms
// ---------------------------------------------------------------------------

export const openApiSourceAtom = (scopeId: ScopeId, namespace: string) =>
  OpenApiClient.query("openapi", "getSource", {
    path: { scopeId, namespace },
    timeToLive: "15 seconds",
    reactivityKeys: [ReactivityKey.sources, ReactivityKey.tools],
  });

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const previewOpenApiSpec = OpenApiClient.mutation("openapi", "previewSpec");

export const addOpenApiSpec = OpenApiClient.mutation("openapi", "addSpec");

export const updateOpenApiSource = OpenApiClient.mutation("openapi", "updateSource");

export const startOpenApiOAuth = OpenApiClient.mutation("openapi", "startOAuth");

export const completeOpenApiOAuth = OpenApiClient.mutation("openapi", "completeOAuth");
