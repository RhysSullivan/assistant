import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type Approval, type WorkspaceId } from "@executor-v2/schema";

import {
  createPmApprovalsService,
  createPmPersistentToolApprovalPolicy,
} from "./approvals-service";

describe("PM persistent approval policy", () => {
  it.effect("creates pending approval records and reuses resolved decisions", () =>
    Effect.gen(function* () {
      const approvals: Array<Approval> = [];

      const approvalRows = {
        approvals: {
          list: () => Effect.succeed(approvals),
          listByWorkspaceId: (workspaceId: WorkspaceId) =>
            Effect.succeed(approvals.filter((approval) => approval.workspaceId === workspaceId)),
          getById: (approvalId: Approval["id"]) =>
            Effect.succeed(
              Option.fromNullable(
                approvals.find((approval) => approval.id === approvalId) ?? null,
              ),
            ),
          findByRunAndCall: (
            workspaceId: Approval["workspaceId"],
            taskRunId: Approval["taskRunId"],
            callId: Approval["callId"],
          ) =>
            Effect.succeed(
              Option.fromNullable(
                approvals.find((approval) =>
                  approval.workspaceId === workspaceId
                  && approval.taskRunId === taskRunId
                  && approval.callId === callId
                ) ?? null,
              ),
            ),
          upsert: (approval: Approval) =>
            Effect.sync(() => {
              const index = approvals.findIndex((item) => item.id === approval.id);
              if (index >= 0) {
                approvals[index] = approval;
                return;
              }

              approvals.push(approval);
            }),
        },
      };

      const policy = createPmPersistentToolApprovalPolicy(approvalRows, {
        requireApprovals: true,
        retryAfterMs: 250,
      });

      const first = yield* Effect.promise(() =>
        Promise.resolve(
          policy.evaluate({
            runId: "run_approval_1",
            callId: "call_approval_1",
            toolPath: "github.repos.delete",
            input: {
              owner: "octocat",
              repo: "hello-world",
            },
            workspaceId: "ws_local",
            source: "github",
            defaultMode: "auto",
          }),
        ),
      );

      expect(first.kind).toBe("pending");
      if (first.kind === "pending") {
        expect(first.retryAfterMs).toBe(250);
      }
      expect(approvals).toHaveLength(1);
      expect(approvals[0]?.status).toBe("pending");
      expect(approvals[0]?.callId).toBe("call_approval_1");

      const second = yield* Effect.promise(() =>
        Promise.resolve(
          policy.evaluate({
            runId: "run_approval_1",
            callId: "call_approval_1",
            toolPath: "github.repos.delete",
            workspaceId: "ws_local",
            source: "github",
            defaultMode: "auto",
          }),
        ),
      );

      expect(second).toEqual(first);
      expect(approvals).toHaveLength(1);

      const approvalsService = createPmApprovalsService(approvalRows);
      const createdApproval = approvals[0];
      if (!createdApproval) {
        throw new Error("expected pending approval record");
      }

      yield* approvalsService.resolveApproval({
        workspaceId: "ws_local" as WorkspaceId,
        approvalId: createdApproval.id,
        payload: {
          status: "approved",
          reason: "approved by test",
        },
      });

      const finalDecision = yield* Effect.promise(() =>
        Promise.resolve(
          policy.evaluate({
            runId: "run_approval_1",
            callId: "call_approval_1",
            toolPath: "github.repos.delete",
            workspaceId: "ws_local",
            source: "github",
            defaultMode: "auto",
          }),
        ),
      );

      expect(finalDecision).toEqual({
        kind: "approved",
      });
    }),
  );
});
