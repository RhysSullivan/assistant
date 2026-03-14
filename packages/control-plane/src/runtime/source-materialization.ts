import type { SqlControlPlaneRows } from "#persistence";
import type {
  AccountId,
  Source,
  SourceStatus,
} from "#schema";
import * as Effect from "effect/Effect";

import {
  buildLocalSourceArtifact,
  writeLocalSourceArtifact,
} from "./local-source-artifacts";
import {
  requireRuntimeLocalWorkspace,
} from "./local-runtime-context";
import {
  loadLocalWorkspaceState,
  writeLocalWorkspaceState,
  type LocalWorkspaceState,
} from "./local-workspace-state";
import { resolveSourceAuthMaterial } from "./source-auth-material";
import {
  getSourceAdapterForSource,
} from "./source-adapters";
import {
  materializationFromMcpManifestEntries,
  persistMcpRecipeRevisionFromManifestEntries,
} from "./source-adapters/mcp";
import type {
  ResolveSecretMaterial as ResolveSourceSecretMaterial,
} from "./secret-material-providers";

const shouldIndexSource = (source: Source): boolean =>
  source.enabled
  && source.status === "connected"
  && getSourceAdapterForSource(source).family !== "internal";

export const syncSourceMaterialization = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  actorAccountId?: AccountId | null;
  resolveSecretMaterial: ResolveSourceSecretMaterial;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace(input.source.workspaceId);

    if (!shouldIndexSource(input.source)) {
      const state = yield* Effect.tryPromise({
        try: () => loadLocalWorkspaceState(runtimeLocalWorkspace.context),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      const existingSourceState = state.sources[input.source.id];
      const nextState: LocalWorkspaceState = {
        ...state,
        sources: {
          ...state.sources,
          [input.source.id]: {
            status: (input.source.enabled ? input.source.status : "draft") as SourceStatus,
            lastError: null,
            sourceHash: input.source.sourceHash,
            createdAt: existingSourceState?.createdAt ?? input.source.createdAt,
            updatedAt: Date.now(),
          },
        },
      };
      yield* Effect.tryPromise({
        try: () =>
          writeLocalWorkspaceState({
            context: runtimeLocalWorkspace.context,
            state: nextState,
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      return;
    }

    const adapter = getSourceAdapterForSource(input.source);
    const materialization = yield* adapter.materializeSource({
      source: input.source,
      resolveSecretMaterial: input.resolveSecretMaterial,
      resolveAuthMaterialForSlot: (slot) =>
        resolveSourceAuthMaterial({
          rows: input.rows,
          source: input.source,
          slot,
          actorAccountId: input.actorAccountId,
          resolveSecretMaterial: input.resolveSecretMaterial,
        }),
    });
    yield* Effect.tryPromise({
      try: () =>
        writeLocalSourceArtifact({
          context: runtimeLocalWorkspace.context,
          sourceId: input.source.id,
          artifact: buildLocalSourceArtifact({
            source: input.source,
            materialization,
          }),
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    const state = yield* Effect.tryPromise({
      try: () => loadLocalWorkspaceState(runtimeLocalWorkspace.context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
    const existingSourceState = state.sources[input.source.id];
    const nextState: LocalWorkspaceState = {
      ...state,
      sources: {
        ...state.sources,
        [input.source.id]: {
          status: "connected",
          lastError: null,
          sourceHash: materialization.sourceHash,
          createdAt: existingSourceState?.createdAt ?? input.source.createdAt,
          updatedAt: Date.now(),
        },
      },
    };
    yield* Effect.tryPromise({
      try: () =>
        writeLocalWorkspaceState({
          context: runtimeLocalWorkspace.context,
          state: nextState,
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
  });

export const persistMcpRecipeMaterializationFromManifest = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  manifestEntries: Parameters<
    typeof persistMcpRecipeRevisionFromManifestEntries
  >[0]["manifestEntries"];
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace(input.source.workspaceId);
    const materialization = materializationFromMcpManifestEntries({
      recipeRevisionId: "src_recipe_rev_materialization" as never,
      endpoint: input.source.endpoint,
      manifestEntries: input.manifestEntries,
    });

    yield* Effect.tryPromise({
      try: () =>
        writeLocalSourceArtifact({
          context: runtimeLocalWorkspace.context,
          sourceId: input.source.id,
          artifact: buildLocalSourceArtifact({
            source: input.source,
            materialization,
          }),
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
  });
