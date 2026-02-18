import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ToolsView } from "@/components/tools/view";
import { normalizeToolsSearch } from "@/lib/url-state/tools";

export const Route = createFileRoute("/tools/policies")({
  validateSearch: (search: Record<string, unknown>) => normalizeToolsSearch(search),
  component: ToolsPoliciesPage,
});

function ToolsPoliciesPage() {
  return (
    <AppShell>
      <ToolsView />
    </AppShell>
  );
}
