import { internal } from "./_generated/api";
import { authedMutation } from "../../core/src/function-builders";
import { safeRunAfter } from "../src/lib/scheduler";

export const deleteCurrentAccount = authedMutation({
  method: "POST",
  args: {},
  handler: async (ctx) => {
    const queued = await safeRunAfter(ctx.scheduler, 0, internal.accountsInternal.runDeleteCurrentAccount, {
      accountId: ctx.account._id,
    });

    if (!queued) {
      throw new Error("Account deletion scheduling is unavailable");
    }

    return {
      queued: true as const,
    };
  },
});
