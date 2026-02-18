import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ToolsView } from "@/components/tools/view";
import { normalizeToolsSearch } from "@/lib/url-state/tools";

export const Route = createFileRoute("/tools/connections")({
  validateSearch: (search: Record<string, unknown>) => normalizeToolsSearch(search),
  component: ToolsConnectionsPage,
});

function ToolsConnectionsPage() {
  return (
    <AppShell>
      <ToolsView />
    </AppShell>
  );
}
