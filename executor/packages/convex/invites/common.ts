import { v } from "convex/values";

export const organizationRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("billing_admin"),
);

export function normalizePersonalOrganizationName(name: string): string {
  const match = name.match(/^(.*)'s Workspace$/i);
  if (!match) {
    return name;
  }
  const ownerName = match[1]?.trim();
  if (!ownerName) {
    return name;
  }
  return `${ownerName}'s Organization`;
}
