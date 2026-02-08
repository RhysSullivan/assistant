"use client";

import { useCallback } from "react";
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

  const refresh = useCallback(async () => {
    // Convex queries are live; manual refresh is not required.
  }, []);

  return {
    tools,
    loading: !!context && tools === undefined,
    refresh,
  };
}
