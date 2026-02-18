import { parseAsStringLiteral } from "nuqs";

export const organizationTabValues = ["members", "billing"] as const;

export type OrganizationTab = (typeof organizationTabValues)[number];

export const organizationQueryParsers = {
  tab: parseAsStringLiteral(organizationTabValues).withDefault("members"),
};

export type OrganizationSearch = {
  tab?: OrganizationTab;
};

export function normalizeOrganizationTab(value: unknown): OrganizationTab {
  return value === "billing" ? "billing" : "members";
}

export function normalizeOrganizationSearch(search: Record<string, unknown>): OrganizationSearch {
  const normalizedTab = normalizeOrganizationTab(search.tab);

  return normalizedTab === "members" ? {} : { tab: normalizedTab };
}
