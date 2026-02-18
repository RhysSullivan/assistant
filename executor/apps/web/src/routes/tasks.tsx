import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TasksView } from "@/components/tasks/tasks-view";
import { normalizeTasksSearch } from "@/lib/url-state/tasks";

export const Route = createFileRoute("/tasks")({
  validateSearch: (search: Record<string, unknown>) => normalizeTasksSearch(search),
  component: TasksPage,
});

function TasksPage() {
  return (
    <AppShell>
      <TasksView />
    </AppShell>
  );
}
