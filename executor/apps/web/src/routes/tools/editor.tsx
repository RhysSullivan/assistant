import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ToolsView } from "@/components/tools/view";

export const Route = createFileRoute("/tools/editor")({
  component: ToolsEditorPage,
});

function ToolsEditorPage() {
  return (
    <AppShell>
      <ToolsView />
    </AppShell>
  );
}
