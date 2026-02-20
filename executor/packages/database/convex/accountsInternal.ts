import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { deleteCurrentAccountBatchStep } from "../src/accounts/delete-current-account-batch";
import { safeRunAfter } from "../src/lib/scheduler";
import { vv } from "./typedV";

const DEFAULT_DELETE_BATCH_SIZE = 200;

function normalizeBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DELETE_BATCH_SIZE;
  }

  return Math.max(50, Math.min(500, Math.floor(value ?? DEFAULT_DELETE_BATCH_SIZE)));
}

export const processDeleteCurrentAccountBatch = internalMutation({
  args: {
    accountId: vv.id("accounts"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await deleteCurrentAccountBatchStep(ctx, {
      accountId: args.accountId,
      maxDeletes: normalizeBatchSize(args.batchSize),
    });

    if (!result.done) {
      await safeRunAfter(ctx.scheduler, 0, internal.accountsInternal.runDeleteCurrentAccount, {
        accountId: args.accountId,
        batchSize: normalizeBatchSize(args.batchSize),
      });
    }

    return result;
  },
});

export const runDeleteCurrentAccount = internalAction({
  args: {
    accountId: vv.id("accounts"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(internal.accountsInternal.processDeleteCurrentAccountBatch, {
      accountId: args.accountId,
      batchSize: normalizeBatchSize(args.batchSize),
    });
  },
});
