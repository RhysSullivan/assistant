import { SourceStoreError } from "@executor-v2/persistence-ports";
import {
  type LocalStateSnapshot,
  type LocalStateStore,
  type LocalStateStoreError,
} from "@executor-v2/persistence-local";
import {
  makeControlPlaneApprovalsService,
  type ControlPlaneApprovalsServiceShape,
} from "@executor-v2/management-api";
import { type Approval } from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const toSourceStoreError = (
  operation: string,
  message: string,
  details: string | null,
): SourceStoreError =>
  new SourceStoreError({
    operation,
    filePath: "local://snapshot.json",
    message,
    reason: null,
    details,
  });

const toSourceStoreErrorFromLocalState = (
  operation: string,
  error: LocalStateStoreError,
): SourceStoreError =>
  toSourceStoreError(operation, error.message, error.details ?? error.reason ?? null);

const findApprovalIndex = (
  approvals: ReadonlyArray<Approval>,
  workspaceId: string,
  approvalId: string,
): number =>
  approvals.findIndex(
    (approval) => approval.workspaceId === workspaceId && approval.id === approvalId,
  );

const sortApprovals = (approvals: ReadonlyArray<Approval>): Array<Approval> =>
  [...approvals].sort((left, right) => right.requestedAt - left.requestedAt);

const updateApproval = (
  snapshot: LocalStateSnapshot,
  index: number,
  nextApproval: Approval,
): LocalStateSnapshot => {
  const approvals = [...snapshot.approvals];
  approvals[index] = nextApproval;

  return {
    ...snapshot,
    generatedAt: Date.now(),
    approvals,
  };
};

export const createPmApprovalsService = (
  localStateStore: LocalStateStore,
): ControlPlaneApprovalsServiceShape =>
  makeControlPlaneApprovalsService({
    listApprovals: (workspaceId) =>
      Effect.gen(function* () {
        const snapshotOption = yield* localStateStore.getSnapshot().pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("approvals.list", error),
          ),
        );

        const snapshot = Option.getOrNull(snapshotOption);
        if (snapshot === null) {
          return [];
        }

        const approvals = snapshot.approvals.filter(
          (approval) => approval.workspaceId === workspaceId,
        );

        return sortApprovals(approvals);
      }),

    resolveApproval: (input) =>
      Effect.gen(function* () {
        const snapshotOption = yield* localStateStore.getSnapshot().pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("approvals.resolve", error),
          ),
        );

        const snapshot = Option.getOrNull(snapshotOption);
        if (snapshot === null) {
          return yield* toSourceStoreError(
            "approvals.resolve",
            "Approval snapshot not found",
            `workspace=${input.workspaceId} approval=${input.approvalId}`,
          );
        }

        const index = findApprovalIndex(
          snapshot.approvals,
          input.workspaceId,
          input.approvalId,
        );

        if (index < 0) {
          return yield* toSourceStoreError(
            "approvals.resolve",
            "Approval not found",
            `workspace=${input.workspaceId} approval=${input.approvalId}`,
          );
        }

        const approval = snapshot.approvals[index];
        if (approval.status !== "pending") {
          return yield* toSourceStoreError(
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

        const nextSnapshot = updateApproval(snapshot, index, resolvedApproval);

        yield* localStateStore.writeSnapshot(nextSnapshot).pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("approvals.resolve_write", error),
          ),
        );

        return resolvedApproval;
      }),
  });
