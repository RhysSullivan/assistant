import { getAccountByWorkosId } from "./auth-db-queries";
import type { DbCtx } from "./auth-types";

type UpsertWorkosAccountArgs = {
  workosUserId: string;
  email: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  now: number;
  includeLastLoginAt: boolean;
};

export async function upsertWorkosAccount(ctx: DbCtx, args: UpsertWorkosAccountArgs) {
  let account = await getAccountByWorkosId(ctx, args.workosUserId);
  const patchData = {
    email: args.email,
    name: args.fullName,
    firstName: args.firstName,
    lastName: args.lastName,
    avatarUrl: args.avatarUrl,
    status: "active" as const,
    updatedAt: args.now,
    ...(args.includeLastLoginAt ? { lastLoginAt: args.now } : null),
  };

  if (account) {
    await ctx.db.patch(account._id, patchData);
    return await ctx.db.get(account._id);
  }

  const accountId = await ctx.db.insert("accounts", {
    provider: "workos",
    providerAccountId: args.workosUserId,
    email: args.email,
    name: args.fullName,
    firstName: args.firstName,
    lastName: args.lastName,
    avatarUrl: args.avatarUrl,
    status: "active",
    createdAt: args.now,
    updatedAt: args.now,
    ...(args.includeLastLoginAt ? { lastLoginAt: args.now } : null),
  });

  return await ctx.db.get(accountId);
}
