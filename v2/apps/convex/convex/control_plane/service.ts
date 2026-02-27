import {
  ControlPlaneService,
  type ControlPlaneServiceShape,
} from "@executor-v2/control-plane";
import * as Effect from "effect/Effect";

import { api } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { toSourceStoreError } from "./errors";

export const makeConvexControlPlaneService = (
  ctx: ActionCtx,
): ControlPlaneServiceShape =>
  ControlPlaneService.of({
    listSources: (workspaceId) =>
      Effect.tryPromise({
        try: () =>
          ctx.runQuery(api.controlPlane.listSources, {
            workspaceId,
          }),
        catch: (cause) => toSourceStoreError("controlPlane.listSources", cause),
      }),
    upsertSource: (input) =>
      Effect.tryPromise({
        try: () =>
          ctx.runMutation(api.controlPlane.upsertSource, {
            workspaceId: input.workspaceId,
            payload: input.payload,
          }),
        catch: (cause) => toSourceStoreError("controlPlane.upsertSource", cause),
      }),
    removeSource: (input) =>
      Effect.tryPromise({
        try: () =>
          ctx.runMutation(api.controlPlane.removeSource, {
            workspaceId: input.workspaceId,
            sourceId: input.sourceId,
          }),
        catch: (cause) => toSourceStoreError("controlPlane.removeSource", cause),
      }),
  });
