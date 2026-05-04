import React, { createContext, useContext, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { workspacesAtom } from "./workspaces";

// ---------------------------------------------------------------------------
// WorkspaceRouteContext — provided by the `/$org/$workspace` layout. The
// hook below also falls back to deriving the value from URL params +
// `workspacesAtom` so callers rendered ABOVE the workspace layout (e.g. the
// Shell + UserFooter, which live in the parent `/$org` layout) still see the
// active workspace.
// ---------------------------------------------------------------------------

export type WorkspaceRouteValue = {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
};

export const WorkspaceRouteContext =
  createContext<WorkspaceRouteValue | null>(null);

export const WorkspaceRouteProvider = (props: {
  value: WorkspaceRouteValue;
  children: React.ReactNode;
}) => (
  <WorkspaceRouteContext.Provider value={props.value}>
    {props.children}
  </WorkspaceRouteContext.Provider>
);

export const useWorkspaceRoute = (): WorkspaceRouteValue => {
  const value = useOptionalWorkspaceRoute();
  if (!value) {
    throw new Error(
      "useWorkspaceRoute requires a workspace URL segment or WorkspaceRouteProvider",
    );
  }
  return value;
};

/**
 * Returns the active workspace if one is encoded in the URL, otherwise null.
 * Resolution order:
 *   1. WorkspaceRouteContext (set by the `/$org/$workspace` layout)
 *   2. URL `workspace` param + workspacesAtom lookup (so callers rendered
 *      above the layout — the parent shell — still see workspace context).
 */
export const useOptionalWorkspaceRoute = (): WorkspaceRouteValue | null => {
  const fromContext = useContext(WorkspaceRouteContext);
  const params = useParams({ strict: false }) as {
    workspace?: string;
  };
  const slug = params.workspace ?? null;
  const result = useAtomValue(workspacesAtom);
  return useMemo<WorkspaceRouteValue | null>(() => {
    if (fromContext) return fromContext;
    if (!slug) return null;
    if (!AsyncResult.isSuccess(result)) return null;
    const found = result.value.workspaces.find((w) => w.slug === slug);
    if (!found) return null;
    return {
      workspaceId: found.id,
      workspaceSlug: found.slug,
      workspaceName: found.name,
    };
  }, [fromContext, slug, result]);
};
