import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const limitArgs = {
  name: v.string(),
  config: v.any(),
  key: v.optional(v.string()),
  count: v.optional(v.number()),
  reserve: v.optional(v.boolean()),
  throws: v.optional(v.boolean()),
};

const limitResult = v.object({
  ok: v.boolean(),
  retryAfter: v.optional(v.number()),
});

export const rateLimit = mutationGeneric({
  args: limitArgs,
  returns: limitResult,
  handler: async () => ({ ok: true }),
});

export const checkRateLimit = queryGeneric({
  args: limitArgs,
  returns: limitResult,
  handler: async () => ({ ok: true }),
});

export const resetRateLimit = mutationGeneric({
  args: {
    name: v.string(),
    key: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async () => null,
});

export const getValue = queryGeneric({
  args: {
    name: v.string(),
    config: v.any(),
    key: v.optional(v.string()),
    sampleShards: v.optional(v.number()),
  },
  returns: v.object({
    config: v.any(),
    shard: v.number(),
    ts: v.number(),
    value: v.number(),
  }),
  handler: async (_ctx, args) => ({
    config: args.config,
    shard: 0,
    ts: Date.now(),
    value: 0,
  }),
});

export const clearAll = mutationGeneric({
  args: {
    before: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async () => null,
});

export const getServerTime = mutationGeneric({
  args: {},
  returns: v.number(),
  handler: async () => Date.now(),
});
