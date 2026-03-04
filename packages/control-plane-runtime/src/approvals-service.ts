import {
  PersistentToolApprovalPolicyStoreError,
  createPersistentToolApprovalPolicy,
  type PersistentToolApprovalRecord,
  type PersistentToolApprovalStore,
  type ToolApprovalPolicy,
} from "@executor-v2/engine";
import { type SqlControlPlanePersistence } from "@executor-v2/persistence-sql";
import {
  makeControlPlaneApprovalsService,
  type ControlPlaneApprovalsServiceShape,
} from "@executor-v2/management-api";
import { type Approval } from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { createSqlSourceStoreErrorMapper } from "./control-plane-row-helpers";

type ApprovalRows = Pick<SqlControlPlanePersistence["rows"], "approvals">;

const sourceStoreError = createSqlSourceStoreErrorMapper("approvals");

const toPersistentApprovalStoreError = (
  operation: string,
  message: string,
  details: string | null,
): PersistentToolApprovalPolicyStoreError =>
  new PersistentToolApprovalPolicyStoreError({
    operation,
    message,
    details,
  });

const toPersistentApprovalStoreErrorFromRowStore = (
  operation: string,
  error: { message: string; details: string | null; reason: string | null },
): PersistentToolApprovalPolicyStoreError =>
  toPersistentApprovalStoreError(operation, error.message, error.details ?? error.reason ?? null);

const toPersistentApprovalRecord = (approval: Approval): PersistentToolApprovalRecord => ({
  approvalId: approval.id,
  workspaceId: approval.workspaceId,
  runId: approval.taskRunId,
  callId: approval.callId,
  toolPath: approval.toolPath,
  status: approval.status,
  reason: approval.reason,
});

export type PmPersistentToolApprovalPolicyOptions = {
  requireApprovals?: boolean;
  retryAfterMs?: number;
};

export const createPmPersistentToolApprovalPolicy = (
  rows: ApprovalRows,
  options: PmPersistentToolApprovalPolicyOptions = {},
): ToolApprovalPolicy => {
  const store: PersistentToolApprovalStore = {
    findByRunAndCall: (input) =>
      rows.approvals
        .findByRunAndCall(
          input.workspaceId as Approval["workspaceId"],
          input.runId as Approval["taskRunId"],
          input.callId,
        )
        .pipe(
        Effect.mapError((error) =>
          toPersistentApprovalStoreErrorFromRowStore("approvals.read", error),
        ),
        Effect.flatMap((approvalOption) => {
          const approval = Option.getOrNull(approvalOption);
          return Effect.succeed(approval !== null ? toPersistentApprovalRecord(approval) : null);
        }),
      ),

    createPending: (input) =>
      Effect.gen(function* () {
        const pendingApproval: Approval = {
          id: `apr_${crypto.randomUUID()}` as Approval["id"],
          workspaceId: input.workspaceId as Approval["workspaceId"],
          taskRunId: input.runId as Approval["taskRunId"],
          callId: input.callId,
          toolPath: input.toolPath,
          status: "pending",
          inputPreviewJson: input.inputPreviewJson,
          reason: null,
          requestedAt: Date.now(),
          resolvedAt: null,
        };

        yield* rows.approvals.upsert(pendingApproval).pipe(
          Effect.mapError((error) =>
            toPersistentApprovalStoreErrorFromRowStore("approvals.write", error),
          ),
        );

        return toPersistentApprovalRecord(pendingApproval);
      }),
  };

  return createPersistentToolApprovalPolicy({
    store,
    requireApprovals: options.requireApprovals,
    retryAfterMs: options.retryAfterMs,
  });
};

export const createPmApprovalsService = (
  rows: ApprovalRows,
): ControlPlaneApprovalsServiceShape =>
  makeControlPlaneApprovalsService({
    listApprovals: (workspaceId) =>
      Effect.gen(function* () {
        const approvals = yield* rows.approvals.listByWorkspaceId(workspaceId).pipe(
          Effect.mapError((error) =>
            sourceStoreError.fromRowStore("approvals.list", error),
          ),
        );

        return approvals;
      }),

    resolveApproval: (input) =>
      Effect.gen(function* () {
        const approvalOption = yield* rows.approvals.getById(input.approvalId).pipe(
          Effect.mapError((error) =>
            sourceStoreError.fromRowStore("approvals.get_by_id", error),
          ),
        );

        const approval = Option.getOrNull(approvalOption);
        if (approval === null || approval.workspaceId !== input.workspaceId) {
          return yield* sourceStoreError.fromMessage(
            "approvals.resolve",
            "Approval not found",
            `workspace=${input.workspaceId} approval=${input.approvalId}`,
          );
        }

        if (approval.status !== "pending") {
          return yield* sourceStoreError.fromMessage(
            "approvals.resolve",
            "Approval is not pending",
            `approval=${input.approvalId} status=${approval.status}`,
          );
        }

        const resolvedApproval: Approval = {
          ...approval,
          status: input.payload.status,
          reason: input.payload.reason ?? approval.reason ?? null,
          resolvedAt: Date.now(),
        };

        yield* rows.approvals.upsert(resolvedApproval).pipe(
          Effect.mapError((error) =>
            sourceStoreError.fromRowStore("approvals.resolve_write", error),
          ),
        );

        return resolvedApproval;
      }),
  });
