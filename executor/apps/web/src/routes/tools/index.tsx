import { Navigate, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { normalizeToolsSearch } from "@/lib/url-state/tools";

export const Route = createFileRoute("/tools/")({
  validateSearch: (search: Record<string, unknown>) => normalizeToolsSearch(search),
  component: ToolsLayout,
});

function ToolsLayout() {
  return (
    <AppShell>
      <Navigate to="/tools/catalog" search={true} replace />
    </AppShell>
  );
}
