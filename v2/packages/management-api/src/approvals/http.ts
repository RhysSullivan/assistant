import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import {
  Actor,
  ActorForbiddenError,
  ActorUnauthenticatedError,
  requirePermission,
  withPolicy,
} from "@executor-v2/domain";
import { type SourceStoreError } from "@executor-v2/persistence-ports";
import { type WorkspaceId } from "@executor-v2/schema";
import * as Effect from "effect/Effect";

import {
  ControlPlaneForbiddenError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "../errors";
import { ControlPlaneApi } from "../api";
import { ControlPlaneActorResolver } from "../auth/actor-resolver";
import { ControlPlaneService } from "../service";

const toStorageError = (
  operation: string,
  cause: SourceStoreError,
): ControlPlaneStorageError =>
  new ControlPlaneStorageError({
    operation,
    message: "Control plane operation failed",
    details: cause.details ?? cause.message,
  });

const toForbiddenError = (
  operation: string,
  cause: ActorForbiddenError,
): ControlPlaneForbiddenError =>
  new ControlPlaneForbiddenError({
    operation,
    message: "Access denied",
    details: `${cause.permission} on ${cause.scope}`,
  });

const toUnauthorizedError = (
  operation: string,
  cause: ActorUnauthenticatedError,
): ControlPlaneUnauthorizedError =>
  new ControlPlaneUnauthorizedError({
    operation,
    message: cause.message,
    details: "Authentication required",
  });

const resolveWorkspaceActor = (workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const actorResolver = yield* ControlPlaneActorResolver;
    const request = yield* HttpServerRequest.HttpServerRequest;

    return yield* actorResolver.resolveWorkspaceActor({
      workspaceId,
      headers: request.headers,
    });
  });

const requireReadApprovals = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "approvals:read",
    workspaceId,
  });

const requireResolveApprovals = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "approvals:resolve",
    workspaceId,
  });

export const ControlPlaneApprovalsLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "approvals",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        Effect.gen(function* () {
          const service = yield* ControlPlaneService;
          const actor = yield* resolveWorkspaceActor(path.workspaceId);

          return yield* withPolicy(requireReadApprovals(path.workspaceId))(
            service.listApprovals(path.workspaceId),
          ).pipe(Effect.provideService(Actor, actor));
        }).pipe(
          Effect.catchTag("ActorUnauthenticatedError", (cause) =>
            toUnauthorizedError("approvals.list", cause),
          ),
          Effect.catchTag("ActorForbiddenError", (cause) =>
            toForbiddenError("approvals.list", cause),
          ),
          Effect.catchTag("SourceStoreError", (cause) =>
            toStorageError("approvals.list", cause),
          ),
        ),
      )
      .handle("resolve", ({ path, payload }) =>
        Effect.gen(function* () {
          const service = yield* ControlPlaneService;
          const actor = yield* resolveWorkspaceActor(path.workspaceId);

          return yield* withPolicy(requireResolveApprovals(path.workspaceId))(
            service.resolveApproval({
              workspaceId: path.workspaceId,
              approvalId: path.approvalId,
              payload,
            }),
          ).pipe(Effect.provideService(Actor, actor));
        }).pipe(
          Effect.catchTag("ActorUnauthenticatedError", (cause) =>
            toUnauthorizedError("approvals.resolve", cause),
          ),
          Effect.catchTag("ActorForbiddenError", (cause) =>
            toForbiddenError("approvals.resolve", cause),
          ),
          Effect.catchTag("SourceStoreError", (cause) =>
            toStorageError("approvals.resolve", cause),
          ),
        ),
      ),
);
