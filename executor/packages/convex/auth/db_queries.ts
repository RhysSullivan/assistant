import type { Doc } from "../_generated/dataModel";
import type { AccountId, DbCtx, OrganizationId } from "./types";

export async function getAccountByWorkosId(ctx: DbCtx, workosUserId: string) {
  return await ctx.db
    .query("accounts")
    .withIndex("by_provider", (q) => q.eq("provider", "workos").eq("providerAccountId", workosUserId))
    .unique();
}

export async function getWorkspaceByWorkosOrgId(ctx: DbCtx, workosOrgId: string) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_workos_org_id", (q) => q.eq("workosOrgId", workosOrgId))
    .unique();
}

export async function getOrganizationByWorkosOrgId(ctx: DbCtx, workosOrgId: string) {
  return await ctx.db
    .query("organizations")
    .withIndex("by_workos_org_id", (q) => q.eq("workosOrgId", workosOrgId))
    .unique();
}

export async function getFirstWorkspaceByOrganizationId(ctx: DbCtx, organizationId: OrganizationId) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId))
    .first();
}

export async function getWorkspaceMembershipByWorkspaceAndAccount(
  ctx: DbCtx,
  workspaceId: Doc<"workspaces">["_id"],
  accountId: AccountId,
) {
  return await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_account", (q) => q.eq("workspaceId", workspaceId).eq("accountId", accountId))
    .unique();
}
