"use node";

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseGraphqlOperationPaths } from "../../core/src/graphql/operation-paths";
import type { AccessPolicyRecord, PolicyDecision, TaskRecord, ToolDefinition } from "../../core/src/types";
import {
  pickBestToolHitByPath,
  unknownToolErrorMessage,
} from "../../core/src/tool-discovery/tool-call-resolution";
import { rehydrateTools, type SerializedTool } from "../../core/src/tool/source-serialization";
import { getDecisionForContext, getToolDecision } from "./policy";
import { normalizeToolPathForLookup } from "./tool_paths";
import { baseTools } from "./workspace_tools";
import { sourceSignature } from "./tool_source_loading";
import { toConvexId } from "../adapters/contracts";

export function getGraphqlDecision(
  task: TaskRecord,
  tool: ToolDefinition,
  input: unknown,
  workspaceTools: Map<string, ToolDefinition> | undefined,
  policies: AccessPolicyRecord[],
): { decision: PolicyDecision; effectivePaths: string[] } {
  const sourceName = tool._graphqlSource!;
  const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const queryString = typeof payload.query === "string" ? payload.query : "";

  if (!queryString.trim()) {
    return { decision: getToolDecision(task, tool, policies), effectivePaths: [tool.path] };
  }

  const { fieldPaths } = parseGraphqlOperationPaths(sourceName, queryString);
  if (fieldPaths.length === 0) {
    return { decision: getToolDecision(task, tool, policies), effectivePaths: [tool.path] };
  }

  let worstDecision: PolicyDecision = "allow";

  for (const fieldPath of fieldPaths) {
    const pseudoTool = workspaceTools?.get(fieldPath);
    const fieldDecision = pseudoTool
      ? getDecisionForContext(
          pseudoTool,
          {
            workspaceId: task.workspaceId,
            actorId: task.actorId,
            clientId: task.clientId,
          },
          policies,
        )
      : getDecisionForContext(
          { ...tool, path: fieldPath, approval: fieldPath.includes(".mutation.") ? "required" : "auto" },
          {
            workspaceId: task.workspaceId,
            actorId: task.actorId,
            clientId: task.clientId,
          },
          policies,
        );

    if (fieldDecision === "deny") {
      worstDecision = "deny";
      break;
    }
    if (fieldDecision === "require_approval") {
      worstDecision = "require_approval";
    }
  }

  return { decision: worstDecision, effectivePaths: fieldPaths };
}

async function resolveRegistryBuildId(
  ctx: ActionCtx,
  workspaceId: TaskRecord["workspaceId"],
): Promise<string> {
  const convexWorkspaceId = toConvexId<"workspaces">(workspaceId);
  const [state, sources] = await Promise.all([
    ctx.runQuery(internal.toolRegistry.getState, { workspaceId: convexWorkspaceId }) as Promise<null | { signature: string; readyBuildId?: string }>,
    ctx.runQuery(internal.database.listToolSources, { workspaceId: convexWorkspaceId }) as Promise<Array<{ id: string; updatedAt: number; enabled: boolean }>>,
  ]);

  const enabledSources = sources.filter((source) => source.enabled);
  const signature = sourceSignature(workspaceId, enabledSources);
  const expectedSignature = `toolreg_v2|${signature}`;
  const buildId = state?.readyBuildId;

  if (!buildId || state.signature !== expectedSignature) {
    throw new Error(
      "Tool registry is not ready (or is stale). Open Tools to refresh, or call listToolsWithWarnings to rebuild.",
    );
  }

  return buildId;
}

async function suggestFromRegistry(
  ctx: ActionCtx,
  workspaceId: TaskRecord["workspaceId"],
  buildId: string,
  toolPath: string,
): Promise<string[]> {
  const term = toolPath.split(".").filter(Boolean).join(" ");
  const hits = await ctx.runQuery(internal.toolRegistry.searchTools, {
    workspaceId: toConvexId<"workspaces">(workspaceId),
    buildId,
    query: term,
    limit: 3,
  }) as Array<{ preferredPath: string }>;
  return hits.map((hit) => hit.preferredPath);
}

export async function resolveToolForCall(
  ctx: ActionCtx,
  task: TaskRecord,
  toolPath: string,
): Promise<{
  tool: ToolDefinition;
  resolvedToolPath: string;
}> {
  const builtin = baseTools.get(toolPath);
  if (builtin) {
    return { tool: builtin, resolvedToolPath: toolPath };
  }

  const buildId = await resolveRegistryBuildId(ctx, task.workspaceId);

  let resolvedToolPath = toolPath;
  let entry = await ctx.runQuery(internal.toolRegistry.getToolByPath, {
    workspaceId: toConvexId<"workspaces">(task.workspaceId),
    buildId,
    path: toolPath,
  }) as null | { path: string; serializedToolJson: string };

  if (!entry) {
    const normalized = normalizeToolPathForLookup(toolPath);
    const hits = await ctx.runQuery(internal.toolRegistry.getToolsByNormalizedPath, {
      workspaceId: toConvexId<"workspaces">(task.workspaceId),
      buildId,
      normalizedPath: normalized,
      limit: 5,
    }) as Array<{ path: string; serializedToolJson: string }>;

    if (hits.length > 0) {
      entry = pickBestToolHitByPath(hits, toolPath);
      if (entry) {
        resolvedToolPath = entry.path;
      }
    }
  }

  if (!entry) {
    const suggestions = await suggestFromRegistry(ctx, task.workspaceId, buildId, toolPath);
    throw new Error(unknownToolErrorMessage(toolPath, suggestions));
  }

  const serialized = JSON.parse(entry.serializedToolJson) as SerializedTool;
  const [tool] = rehydrateTools([serialized], baseTools);
  if (!tool) {
    throw new Error(`Failed to rehydrate tool: ${resolvedToolPath}`);
  }

  return { tool, resolvedToolPath };
}
