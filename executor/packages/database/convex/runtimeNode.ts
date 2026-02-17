"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  dispatchCloudflareWorkerRun,
  executeLocalVmRun,
} from "../src/runtime-node/runtime-dispatch";
import { compileExternalToolSource as compileExternalToolSourceInNode } from "../../core/src/tool-sources";
import { prepareOpenApiSpec as prepareOpenApiSpecInNode } from "../../core/src/openapi-prepare";
import { readVaultObjectHandler } from "../src/credentials-node/read-vault-object";
import { upsertCredentialHandler } from "../src/credentials-node/upsert-credential";
import {
  credentialProviderValidator,
  credentialScopeTypeValidator,
  jsonObjectValidator,
} from "../src/database/validators";

export const executeLocalVm = internalAction({
  args: {
    taskId: v.string(),
    code: v.string(),
    timeoutMs: v.number(),
  },
  handler: async (_ctx, args) => {
    return await executeLocalVmRun(args);
  },
});

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

export const compileExternalToolSource = internalAction({
  args: {
    source: jsonObjectValidator,
  },
  handler: async (_ctx, args) => {
    const source = args.source as unknown as { type?: string; name?: string };
    if (typeof source.type !== "string" || typeof source.name !== "string") {
      throw new Error("Runtime source compile requires source.type and source.name");
    }
    return await compileExternalToolSourceInNode(args.source as any);
  },
});

export const prepareOpenApiSpec = internalAction({
  args: {
    specUrl: v.string(),
    sourceName: v.string(),
    includeDts: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    return await prepareOpenApiSpecInNode(args.specUrl, args.sourceName, {
      includeDts: args.includeDts,
    });
  },
});

export const upsertCredential = internalAction({
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
    return await upsertCredentialHandler(ctx, internal, args);
  },
});

export const readVaultObject = internalAction({
  args: {
    objectId: v.string(),
    apiKey: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<string> => {
    return await readVaultObjectHandler(args);
  },
});
