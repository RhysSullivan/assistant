import { ReactivityKey } from "@executor-js/react/api/reactivity-keys";

import { CloudApiClient } from "./client";

// ---------------------------------------------------------------------------
// Workspaces atoms — typed queries against OrgHttpApi.workspaces (mounted at
// `/api/:org/workspaces`). The CloudApiClient is configured against the
// org-prefixed baseUrl in `routes/$org.tsx`, so these calls naturally resolve
// to the active org. The `workspaces` reactivity key is invalidated by
// `createWorkspaceMutation` on success — subscribers refetch automatically.
// ---------------------------------------------------------------------------

/** List workspaces for the active org. Refetches on `workspaces` key changes. */
export const workspacesAtom = CloudApiClient.query("workspaces", "listWorkspaces", {
  timeToLive: "5 minutes",
  reactivityKeys: [ReactivityKey.workspaces],
});

/** Create a workspace under the active org. Returns the new workspace row. */
export const createWorkspaceMutation = CloudApiClient.mutation(
  "workspaces",
  "createWorkspace",
);

export type WorkspaceListItem = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
};
