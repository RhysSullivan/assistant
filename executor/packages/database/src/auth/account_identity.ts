import type { Id } from "../../convex/_generated/dataModel.d.ts";

type WorkspaceAccessIdentity = {
  accountId: Id<"accounts">;
};

export function canonicalAccountIdForWorkspaceAccess(access: WorkspaceAccessIdentity): Id<"accounts"> {
  return access.accountId;
}

export function assertMatchesCanonicalAccountId(
  providedAccountId: string | undefined,
  canonicalAccountId: Id<"accounts">,
  fieldName = "accountId",
): void {
  if (providedAccountId && providedAccountId !== canonicalAccountId) {
    throw new Error(`${fieldName} must match the authenticated workspace account`);
  }
}
