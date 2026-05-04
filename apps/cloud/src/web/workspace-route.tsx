import React, { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// WorkspaceRouteContext — provided by the `/$org/$workspace` layout, consumed
// by descendants (shell nav, nav links, etc.) that need to know the URL-active
// workspace. Mirrors `OrgRouteContext` but for the inner workspace segment.
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
  const value = useContext(WorkspaceRouteContext);
  if (!value) {
    throw new Error(
      "useWorkspaceRoute must be used within a WorkspaceRouteProvider",
    );
  }
  return value;
};

/** Optional variant for shell components rendered both inside and outside the
 *  workspace layout. Returns `null` when the URL is org-only. */
export const useOptionalWorkspaceRoute = (): WorkspaceRouteValue | null =>
  useContext(WorkspaceRouteContext);
