import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Navigate, useLocation } from "@/lib/router";

export const Route = createFileRoute("/tools/")({
  component: ToolsLayout,
});

function ToolsLayout() {
  const location = useLocation();
  const search = location.searchStr ? `?${location.searchStr}` : "";

  return (
    <AppShell>
      <Navigate to={`/tools/catalog${search}`} replace />
    </AppShell>
  );
}
