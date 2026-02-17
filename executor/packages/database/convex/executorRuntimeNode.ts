"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { dispatchCloudflareWorkerRun } from "../src/runtime-node/runtime-dispatch";

export const dispatchCloudflareWorker = internalAction({
  args: {
    taskId: v.string(),
    code: v.string(),
    timeoutMs: v.number(),
  },
  handler: async (_ctx, args) => {
    return await dispatchCloudflareWorkerRun(args);
  },
});
