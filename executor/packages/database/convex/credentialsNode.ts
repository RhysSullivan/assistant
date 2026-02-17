import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { customAction } from "../../core/src/function-builders";
import {
  credentialProviderValidator,
  credentialScopeTypeValidator,
  jsonObjectValidator,
} from "../src/database/validators";

export const upsertCredential = customAction({
  method: "POST",
  args: {
    id: v.optional(v.string()),
    workspaceId: v.id("workspaces"),
    sessionId: v.optional(v.string()),
    scopeType: v.optional(credentialScopeTypeValidator),
    sourceKey: v.string(),
    accountId: v.optional(v.id("accounts")),
    provider: v.optional(credentialProviderValidator),
    secretJson: jsonObjectValidator,
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    return await ctx.runAction(internal.runtimeNode.upsertCredential, args);
  },
});

export const readVaultObject = internalAction({
  args: {
    objectId: v.string(),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    return await ctx.runAction(internal.runtimeNode.readVaultObject, args);
  },
});
