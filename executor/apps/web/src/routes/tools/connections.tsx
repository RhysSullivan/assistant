import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ToolsView } from "@/components/tools/view";

export const Route = createFileRoute("/tools/connections")({
  component: ToolsConnectionsPage,
});

function ToolsConnectionsPage() {
  return (
    <AppShell>
      <ToolsView />
    </AppShell>
  );
}
