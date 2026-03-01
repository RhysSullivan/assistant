import {
  type ResolveApprovalPayload,
} from "@executor-v2/management-api";
import {
  ApprovalSchema,
  type Approval,
} from "@executor-v2/schema";
import { v } from "convex/values";
import * as Schema from "effect/Schema";

import { mutation, query } from "../_generated/server";

const decodeApproval = Schema.decodeUnknownSync(ApprovalSchema);

const stripConvexSystemFields = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...rest } = value;
  return rest;
};

const approvalStatusValidator = v.union(
  v.literal("approved"),
  v.literal("denied"),
);

const sortApprovals = (approvals: ReadonlyArray<Approval>): Array<Approval> =>
  [...approvals].sort((left, right) => right.requestedAt - left.requestedAt);

export const listApprovals = query({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<Approval>> => {
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return sortApprovals(
      rows.map((row) =>
        decodeApproval(
          stripConvexSystemFields(row as unknown as Record<string, unknown>),
        ),
      ),
    );
  },
});

export const resolveApproval = mutation({
  args: {
    workspaceId: v.string(),
    approvalId: v.string(),
    payload: v.object({
      status: approvalStatusValidator,
      reason: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, args): Promise<Approval> => {
    const row = await ctx.db
      .query("approvals")
      .withIndex("by_domainId", (q) => q.eq("id", args.approvalId))
      .unique();

    if (!row || row.workspaceId !== args.workspaceId) {
      throw new Error(`Approval not found: ${args.approvalId}`);
    }

    const approval = decodeApproval(
      stripConvexSystemFields(row as unknown as Record<string, unknown>),
    );

    if (approval.status !== "pending") {
      throw new Error(`Approval is not pending: ${args.approvalId}`);
    }

    const payload = args.payload as ResolveApprovalPayload;
    const updatedAt = Date.now();

    const resolvedApproval: Approval = {
      ...approval,
      status: payload.status,
      reason: payload.reason ?? approval.reason ?? null,
      resolvedAt: updatedAt,
    };

    await ctx.db.patch(row._id, {
      status: resolvedApproval.status,
      reason: resolvedApproval.reason,
      resolvedAt: resolvedApproval.resolvedAt,
    });

    return resolvedApproval;
  },
});
