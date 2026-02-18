"use client";

import { useCallback } from "react";
import { useQueryStates } from "nuqs";
import { CreditCard, Users } from "lucide-react";
import { BillingView } from "@/components/organization/billing-view";
import { MembersView } from "@/components/organization/members-view";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  normalizeOrganizationTab,
  organizationQueryParsers,
  type OrganizationTab,
} from "@/lib/url-state/organization";

export function OrganizationSettingsView() {
  const [organizationQueryState, setOrganizationQueryState] = useQueryStates(organizationQueryParsers, {
    history: "replace",
  });
  const tab = organizationQueryState.tab;

  const setTab = useCallback((nextTab: string) => {
    const normalizedTab = normalizeOrganizationTab(nextTab);
    void setOrganizationQueryState({ tab: normalizedTab }, { history: "replace" });
  }, [setOrganizationQueryState]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Settings"
        description="Manage organization-level members, invites, and billing"
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as OrganizationTab)}>
        <TabsList>
          <TabsTrigger value="members">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="h-4 w-4" />
            Billing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <MembersView showHeader={false} />
        </TabsContent>
        <TabsContent value="billing">
          <BillingView showHeader={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
