"use node";

import type { ActionCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel.d.ts";
import { internal } from "../../convex/_generated/api";
import { sourceSignature } from "./tool_source_loading";

export const TOOL_REGISTRY_SIGNATURE_PREFIX = "toolreg_v2|";

export function registrySignatureForWorkspace(
  workspaceId: Id<"workspaces">,
  sources: Array<{ id: string; updatedAt: number; enabled: boolean }>,
): string {
  const enabledSources = sources.filter((source) => source.enabled);
  return `${TOOL_REGISTRY_SIGNATURE_PREFIX}${sourceSignature(workspaceId, enabledSources)}`;
}

type RegistryState = {
  signature: string;
  readyBuildId?: string;
} | null;

type ToolSourceState = {
  id: string;
  updatedAt: number;
  enabled: boolean;
};

async function readRegistryState(
  ctx: Pick<ActionCtx, "runQuery">,
  workspaceId: Id<"workspaces">,
): Promise<{ buildId?: string; isReady: boolean }> {
  const [state, sources] = await Promise.all([
    ctx.runQuery(internal.toolRegistry.getState, { workspaceId }) as Promise<RegistryState>,
    ctx.runQuery(internal.database.listToolSources, { workspaceId }) as Promise<ToolSourceState[]>,
  ]);

  const expectedSignature = registrySignatureForWorkspace(workspaceId, sources);
  const buildId = state?.readyBuildId;

  return {
    buildId,
    isReady: Boolean(buildId && state?.signature === expectedSignature),
  };
}

export async function getReadyRegistryBuildId(
  ctx: Pick<ActionCtx, "runQuery" | "runAction">,
  args: {
    workspaceId: Id<"workspaces">;
    actorId?: string;
    clientId?: string;
    refreshOnStale?: boolean;
  },
): Promise<string> {
  const initial = await readRegistryState(ctx, args.workspaceId);
  if (initial.isReady && initial.buildId) {
    return initial.buildId;
  }

  if (args.refreshOnStale) {
    await ctx.runAction(internal.executorNode.listToolsWithWarningsInternal, {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      clientId: args.clientId,
    });

    const refreshed = await readRegistryState(ctx, args.workspaceId);
    if (refreshed.isReady && refreshed.buildId) {
      return refreshed.buildId;
    }
  }

  throw new Error(
    "Tool registry is not ready (or is stale). Open Tools to refresh, or call listToolsWithWarnings to rebuild.",
  );
}
