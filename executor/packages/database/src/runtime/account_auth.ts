"use node";

import type { ActionCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel.d.ts";
import { internal } from "../../convex/_generated/api";
import {
  assertMatchesCanonicalAccountId,
  canonicalAccountIdForWorkspaceAccess,
} from "../auth/account_identity";

export async function requireCanonicalAccount(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    sessionId?: string;
    accountId?: Id<"accounts">;
  },
): Promise<{ accountId: Id<"accounts"> }> {
  const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForRequest, {
    workspaceId: args.workspaceId,
    sessionId: args.sessionId,
  });
  const canonicalAccountId = canonicalAccountIdForWorkspaceAccess(access);
  assertMatchesCanonicalAccountId(args.accountId, canonicalAccountId);
  return {
    accountId: canonicalAccountId,
  };
}
