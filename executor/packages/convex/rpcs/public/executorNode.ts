"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import type {
  ToolDescriptor,
  OpenApiSourceQuality,
  SourceAuthProfile,
} from "../../../core/src/types";
import { requireCanonicalActor } from "../../runtime/actor_auth";
import { safeRunAfter } from "../../lib/scheduler";
import {
  listToolsWithWarningsForContext,
  type WorkspaceToolsDebug,
} from "../../runtime/workspace_tools";

export const listToolsWithWarnings = action({
  args: {
    workspaceId: v.id("workspaces"),
    actorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    includeDetails: v.optional(v.boolean()),
    includeSourceMeta: v.optional(v.boolean()),
    toolPaths: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    tools: ToolDescriptor[];
    warnings: string[];
    typesUrl?: string;
    sourceQuality: Record<string, OpenApiSourceQuality>;
    sourceAuthProfiles: Record<string, SourceAuthProfile>;
    debug: WorkspaceToolsDebug;
  }> => {
    const canonicalActorId = await requireCanonicalActor(ctx, {
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      actorId: args.actorId,
    });

    const inventory = await listToolsWithWarningsForContext(
      ctx,
      {
        workspaceId: args.workspaceId,
        actorId: canonicalActorId,
        clientId: args.clientId,
      },
      {
        includeDetails: args.includeDetails ?? true,
        includeSourceMeta: args.includeSourceMeta ?? (args.toolPaths ? false : true),
        toolPaths: args.toolPaths,
        sourceTimeoutMs: 2_500,
        allowStaleOnMismatch: true,
      },
    );

    if (inventory.warnings.some((warning) => warning.includes("showing previous results while refreshing"))) {
      try {
        await safeRunAfter(ctx.scheduler, 0, internal.executorNode.listToolsWithWarningsInternal, {
          workspaceId: args.workspaceId,
          actorId: canonicalActorId,
          clientId: args.clientId,
        });
      } catch {
        // Best effort refresh only.
      }
    }

    return inventory;
  },
});
