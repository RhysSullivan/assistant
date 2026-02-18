import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { OrganizationSettingsView } from "@/components/organization/organization/settings-view";
import { normalizeOrganizationSearch } from "@/lib/url-state/organization";

export const Route = createFileRoute("/organization")({
  validateSearch: (search: Record<string, unknown>) => normalizeOrganizationSearch(search),
  component: OrganizationPage,
});

function OrganizationPage() {
  return (
    <AppShell>
      <OrganizationSettingsView />
    </AppShell>
  );
}
