import { createFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { useOrgRoute } from "../../web/org-route";
import { WorkspaceRouteProvider } from "../../web/workspace-route";
import { workspacesAtom } from "../../web/workspaces";

export const Route = createFileRoute("/$org/$workspace")({
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const navigate = useNavigate();
  const { org, workspace: slug } = useParams({ from: Route.id });
  const { orgHandle } = useOrgRoute();
  const result = useAtomValue(workspacesAtom);

  // Resolve the slug from the listWorkspaces query. The CloudApiClient is
  // already bound to the org-prefixed baseUrl by the parent `/$org` layout, so
  // this `listWorkspaces` call hits `/api/$org/workspaces`. We only navigate
  // away once the query has succeeded — until then we render the loading view
  // (mirrors how `/$org` handles its membership lookup).
  const { workspace, ready } = useMemo(() => {
    if (AsyncResult.isSuccess(result)) {
      const found =
        result.value.workspaces.find((w) => w.slug === slug) ?? null;
      return { workspace: found, ready: true };
    }
    return { workspace: null, ready: false };
  }, [result, slug]);

  useEffect(() => {
    if (!ready) return;
    if (workspace) return;
    void navigate({ to: "/$org", params: { org }, replace: true });
  }, [ready, workspace, navigate, org]);

  if (!ready) return null;
  if (!workspace) return null;

  // Sanity check: render under the same orgHandle that produced the listing.
  // If the org param drifts mid-navigation we'd resolve a stale workspace —
  // surfaces as a fast remount once the parent updates.
  if (orgHandle !== org) return null;

  return (
    <WorkspaceRouteProvider
      value={{
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
      }}
    >
      <Outlet />
    </WorkspaceRouteProvider>
  );
}
