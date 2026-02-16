import { actorIdForAccount } from "../../../core/src/identity";

type WorkspaceAccessIdentity = {
  actorId?: string;
  accountId: string;
  provider: string;
  providerAccountId: string;
};

export function canonicalActorIdForWorkspaceAccess(access: WorkspaceAccessIdentity): string {
  const existingActorId = typeof access.actorId === "string" ? access.actorId.trim() : "";
  if (existingActorId.length > 0) {
    return existingActorId;
  }

  return actorIdForAccount({
    _id: access.accountId,
    provider: access.provider,
    providerAccountId: access.providerAccountId,
  });
}

export function assertMatchesCanonicalActorId(
  providedActorId: string | undefined,
  canonicalActorId: string,
  fieldName = "actorId",
): void {
  if (providedActorId && providedActorId !== canonicalActorId) {
    throw new Error(`${fieldName} must match the authenticated workspace actor`);
  }
}
