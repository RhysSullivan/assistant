import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ToolsView } from "@/components/tools/view";
import { normalizeToolsSearch } from "@/lib/url-state/tools";

export const Route = createFileRoute("/tools/storage")({
  validateSearch: (search: Record<string, unknown>) => normalizeToolsSearch(search),
  component: ToolsStoragePage,
});

function ToolsStoragePage() {
  return (
    <AppShell>
      <ToolsView />
    </AppShell>
  );
}
