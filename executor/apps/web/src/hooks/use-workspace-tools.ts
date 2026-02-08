"use client";

import { useQuery } from "convex/react";
import { convexApi } from "../lib/convex-api";

interface WorkspaceContext {
  workspaceId: string;
  actorId?: string;
  clientId?: string;
}

export function useWorkspaceTools(context: WorkspaceContext | null) {
  const tools = useQuery(
    convexApi.database.listWorkspaceToolsForContext,
    context
      ? {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          clientId: context.clientId,
        }
      : "skip",
  );

  return {
    tools,
    loading: !!context && tools === undefined,
  };
}
