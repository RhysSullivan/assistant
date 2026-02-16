import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { listRuntimeTargets as listAvailableRuntimeTargets } from "../../../core/src/runtimes/runtime-catalog";
import { mapPolicy } from "../../src/database/mappers";
import {
  policyApprovalModeValidator,
  policyDecisionValidator,
  policyEffectValidator,
  policyMatchTypeValidator,
  policyScopeTypeValidator,
} from "../../src/database/validators";

function parseDecision(value: "allow" | "require_approval" | "deny" | undefined): {
  effect: "allow" | "deny";
  approvalMode: "inherit" | "auto" | "required";
} {
  if (value === "deny") {
    return { effect: "deny", approvalMode: "inherit" };
  }
  if (value === "require_approval") {
    return { effect: "allow", approvalMode: "required" };
  }
  return { effect: "allow", approvalMode: "auto" };
}

export const listRuntimeTargets = internalQuery({
  args: {},
  handler: async () => {
    return listAvailableRuntimeTargets();
  },
});

export const upsertAccessPolicy = internalMutation({
  args: {
    id: v.optional(v.string()),
    workspaceId: v.id("workspaces"),
    scopeType: v.optional(policyScopeTypeValidator),
    actorId: v.optional(v.string()),
    targetActorId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    toolPathPattern: v.optional(v.string()),
    resourcePattern: v.optional(v.string()),
    matchType: v.optional(policyMatchTypeValidator),
    decision: v.optional(policyDecisionValidator),
    effect: v.optional(policyEffectValidator),
    approvalMode: v.optional(policyApprovalModeValidator),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const policyId = args.id ?? `policy_${crypto.randomUUID()}`;
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    const scopeType = args.scopeType ?? "workspace";
    const targetActorId = (args.targetActorId ?? args.actorId)?.trim() || undefined;
    const resourcePattern = (args.resourcePattern ?? args.toolPathPattern ?? "*").trim() || "*";
    const matchType = args.matchType ?? "glob";
    const decisionFields = parseDecision(args.decision);
    const effect = args.effect ?? decisionFields.effect;
    const approvalMode = args.approvalMode ?? decisionFields.approvalMode;

    const existing = await ctx.db
      .query("accessPolicies")
      .withIndex("by_policy_id", (q) => q.eq("policyId", policyId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        scopeType,
        organizationId: workspace.organizationId,
        workspaceId: scopeType === "workspace" ? args.workspaceId : undefined,
        targetActorId,
        clientId: args.clientId?.trim() || undefined,
        resourceType: "tool_path",
        resourcePattern,
        matchType,
        effect,
        approvalMode,
        priority: args.priority ?? 100,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("accessPolicies", {
        policyId,
        scopeType,
        organizationId: workspace.organizationId,
        workspaceId: scopeType === "workspace" ? args.workspaceId : undefined,
        targetActorId,
        clientId: args.clientId?.trim() || undefined,
        resourceType: "tool_path",
        resourcePattern,
        matchType,
        effect,
        approvalMode,
        priority: args.priority ?? 100,
        createdAt: now,
        updatedAt: now,
      });
    }

    const updated = await ctx.db
      .query("accessPolicies")
      .withIndex("by_policy_id", (q) => q.eq("policyId", policyId))
      .unique();
    if (!updated) {
      throw new Error(`Failed to read policy ${policyId}`);
    }
    return mapPolicy(updated);
  },
});

export const listAccessPolicies = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return [];
    }

    const workspaceDocs = await ctx.db
      .query("accessPolicies")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const organizationDocs = await ctx.db
      .query("accessPolicies")
      .withIndex("by_organization_created", (q) => q.eq("organizationId", workspace.organizationId))
      .collect();

    const all = [...workspaceDocs, ...organizationDocs.filter((doc) => doc.scopeType === "organization")].filter((doc, index, entries) => {
      return entries.findIndex((candidate) => candidate.policyId === doc.policyId) === index;
    });

    return all
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt - b.createdAt;
      })
      .map(mapPolicy);
  },
});
