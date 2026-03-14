import type { WorkspaceId } from "#schema";
import * as Effect from "effect/Effect";

import { requireRuntimeLocalWorkspace } from "../runtime/local-runtime-context";
import { ControlPlaneForbiddenError } from "./errors";

export const resolveRequestedLocalWorkspace = (
  operation: string,
  workspaceId: WorkspaceId,
) =>
  requireRuntimeLocalWorkspace(workspaceId).pipe(
    Effect.mapError((cause) =>
      new ControlPlaneForbiddenError({
        operation,
        message: "Requested workspace is not the active local workspace",
        details: cause instanceof Error ? cause.message : String(cause),
      })
    ),
  );
