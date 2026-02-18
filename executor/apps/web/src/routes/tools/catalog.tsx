import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ToolsView } from "@/components/tools/view";

export const Route = createFileRoute("/tools/catalog")({
  component: ToolsCatalogPage,
});

function ToolsCatalogPage() {
  return (
    <AppShell>
      <ToolsView />
    </AppShell>
  );
}
