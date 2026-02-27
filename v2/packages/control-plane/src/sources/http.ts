import { HttpApiBuilder } from "@effect/platform";
import { type SourceStoreError } from "@executor-v2/persistence-ports";
import * as Effect from "effect/Effect";

import { ControlPlaneBadRequestError, ControlPlaneStorageError } from "../errors";
import { ControlPlaneService } from "../service";
import { ControlPlaneApi } from "../api";

const toStorageError = (
  operation: string,
  cause: SourceStoreError,
): ControlPlaneStorageError =>
  new ControlPlaneStorageError({
    operation,
    message: "Control plane operation failed",
    details: cause.details ?? cause.message,
  });

export const ControlPlaneSourcesLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "sources",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        Effect.gen(function* () {
          const service = yield* ControlPlaneService;
          return yield* service.listSources(path.workspaceId);
        }).pipe(
          Effect.catchTag("SourceStoreError", (cause) =>
            toStorageError("sources.list", cause),
          ),
        ),
      )
      .handle("upsert", ({ path, payload }) =>
        Effect.gen(function* () {
          const service = yield* ControlPlaneService;
          return yield* service.upsertSource({
            workspaceId: path.workspaceId,
            payload,
          });
        }).pipe(
          Effect.catchTag("SourceCatalogValidationError", (error) =>
            new ControlPlaneBadRequestError({
              operation: error.operation,
              message: error.message,
              details: error.details,
            }),
          ),
          Effect.catchTag("SourceStoreError", (cause) =>
            toStorageError("sources.upsert", cause),
          ),
        ),
      )
      .handle("remove", ({ path }) =>
        Effect.gen(function* () {
          const service = yield* ControlPlaneService;
          return yield* service.removeSource({
            workspaceId: path.workspaceId,
            sourceId: path.sourceId,
          });
        }).pipe(
          Effect.catchTag("SourceStoreError", (cause) =>
            toStorageError("sources.remove", cause),
          ),
        ),
      ),
);
