import type { AnonymousContext } from "@/lib/types";

export function workspaceQueryArgs(context: AnonymousContext | null | undefined) {
  return context
    ? { workspaceId: context.workspaceId, sessionId: context.sessionId }
    : "skip";
}
