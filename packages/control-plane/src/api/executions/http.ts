import { HttpApiBuilder } from "@effect/platform";
import * as Effect from "effect/Effect";
import {
  createExecution,
  getExecution,
  resumeExecution,
} from "../../runtime/execution-service";

import { ControlPlaneApi } from "../api";
import { resolveRequestedLocalWorkspace } from "../local-context";

export const ControlPlaneExecutionsLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "executions",
  (handlers) =>
    handlers
      .handle("create", ({ path, payload }) =>
        resolveRequestedLocalWorkspace("executions.create", path.workspaceId).pipe(
          Effect.flatMap((runtimeLocalWorkspace) =>
            createExecution({
              workspaceId: path.workspaceId,
              payload,
              createdByAccountId: runtimeLocalWorkspace.installation.accountId,
            })
          ),
        ),
      )
      .handle("get", ({ path }) =>
        resolveRequestedLocalWorkspace("executions.get", path.workspaceId).pipe(
          Effect.zipRight(
            getExecution({
              workspaceId: path.workspaceId,
              executionId: path.executionId,
            }),
          ),
        ),
      )
      .handle("resume", ({ path, payload }) =>
        resolveRequestedLocalWorkspace("executions.resume", path.workspaceId).pipe(
          Effect.flatMap((runtimeLocalWorkspace) =>
            resumeExecution({
              workspaceId: path.workspaceId,
              executionId: path.executionId,
              payload,
              resumedByAccountId: runtimeLocalWorkspace.installation.accountId,
            })
          ),
        ),
      ),
);
