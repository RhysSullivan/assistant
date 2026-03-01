import { type SourceStoreError } from "@executor-v2/persistence-ports";
import { type Approval, type ApprovalId, type WorkspaceId } from "@executor-v2/schema";
import * as Effect from "effect/Effect";

import type { ResolveApprovalPayload } from "./api";

export type ResolveApprovalInput = {
  workspaceId: WorkspaceId;
  approvalId: ApprovalId;
  payload: ResolveApprovalPayload;
};

export type ControlPlaneApprovalsServiceShape = {
  listApprovals: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<ReadonlyArray<Approval>, SourceStoreError>;
  resolveApproval: (
    input: ResolveApprovalInput,
  ) => Effect.Effect<Approval, SourceStoreError>;
};

export const makeControlPlaneApprovalsService = (
  service: ControlPlaneApprovalsServiceShape,
): ControlPlaneApprovalsServiceShape => service;
