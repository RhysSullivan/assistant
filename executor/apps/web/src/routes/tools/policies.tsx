import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ToolsView } from "@/components/tools/view";

export const Route = createFileRoute("/tools/policies")({
  component: ToolsPoliciesPage,
});

function ToolsPoliciesPage() {
  return (
    <AppShell>
      <ToolsView />
    </AppShell>
  );
}
