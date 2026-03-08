import type {
  ConnectMcpSourcePayload,
  CreateSourcePayload,
  UpdateSourcePayload,
} from "../api/sources/api";
import {
  SourceIdSchema,
  type Source,
  type SourceId,
  type WorkspaceId,
} from "#schema";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  createSourceFromPayload,
  updateSourceFromPayload,
} from "./source-definitions";
import {
  mapPersistenceError,
} from "./operations-shared";
import {
  operationErrors,
} from "./operation-errors";
import { createDefaultSecretMaterialResolver } from "./secret-material-providers";
import { RuntimeSourceAuthServiceTag } from "./source-auth-service";
import { ControlPlaneStore, type ControlPlaneStoreShape } from "./store";
import { syncSourceToolArtifacts } from "./tool-artifacts";
import {
  loadSourceById,
  loadSourcesInWorkspace,
  persistSource,
  removeSourceById,
} from "./source-store";

const sourceOps = {
  list: operationErrors("sources.list"),
  create: operationErrors("sources.create"),
  get: operationErrors("sources.get"),
  update: operationErrors("sources.update"),
  connectMcp: operationErrors("sources.connectMcp"),
  remove: operationErrors("sources.remove"),
} as const;

const syncArtifactsForSource = (input: {
  store: ControlPlaneStoreShape;
  source: Source;
  operation:
    | typeof sourceOps.create
    | typeof sourceOps.update;
}) =>
  Effect.gen(function* () {
    const resolveSecretMaterial = createDefaultSecretMaterialResolver({
      rows: input.store,
    });

    const synced = yield* Effect.either(
      syncSourceToolArtifacts({
        rows: input.store,
        source: input.source,
        resolveSecretMaterial,
      }),
    );

    return yield* Either.match(synced, {
      onRight: () => Effect.succeed(input.source),
      onLeft: (error) =>
        Effect.gen(function* () {
          if (input.source.enabled && input.source.status === "connected") {
            const erroredSource = yield* updateSourceFromPayload({
              source: input.source,
              payload: {
                status: "error",
                lastError: error.message,
              },
              now: Date.now(),
          }).pipe(
            Effect.mapError((cause) =>
              input.operation.badRequest(
                "Failed indexing source tools",
                cause instanceof Error ? cause.message : String(cause),
                ),
              ),
            );

            yield* mapPersistenceError(
              input.operation.child("source_error"),
              persistSource(input.store, erroredSource),
            );
          }

          return yield* Effect.fail(
            input.operation.unknownStorage(error, "Failed syncing source tools"),
          );
        }),
    });
  });

export const listSources = (workspaceId: WorkspaceId) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    loadSourcesInWorkspace(store, workspaceId).pipe(
      Effect.mapError((error) =>
        sourceOps.list.unknownStorage(
          error,
          "Failed projecting stored sources",
        ),
      ),
    ));

export const createSource = (input: {
  workspaceId: WorkspaceId;
  payload: CreateSourcePayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      const now = Date.now();

      const source = yield* createSourceFromPayload({
        workspaceId: input.workspaceId,
        sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
        payload: input.payload,
        now,
      }).pipe(
        Effect.mapError((cause) =>
          sourceOps.create.badRequest(
            "Invalid source definition",
            cause instanceof Error ? cause.message : String(cause),
          ),
        ),
      );

      yield* mapPersistenceError(
        sourceOps.create.child("persist"),
        persistSource(store, source),
      );

      return yield* syncArtifactsForSource({
        store,
        source,
        operation: sourceOps.create,
      });
    }));

export const getSource = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    loadSourceById(store, {
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error && cause.message.startsWith("Source not found:")
          ? sourceOps.get.notFound(
              "Source not found",
              `workspaceId=${input.workspaceId} sourceId=${input.sourceId}`,
            )
          : sourceOps.get.unknownStorage(
              cause,
              "Failed projecting stored source",
            ),
      ),
    ));

export const updateSource = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  payload: UpdateSourcePayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      const existingSource = yield* loadSourceById(store, {
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error && cause.message.startsWith("Source not found:")
            ? sourceOps.update.notFound(
                "Source not found",
                `workspaceId=${input.workspaceId} sourceId=${input.sourceId}`,
              )
            : sourceOps.update.unknownStorage(
                cause,
                "Failed projecting stored source",
              ),
        ),
      );

      const updatedSource = yield* updateSourceFromPayload({
        source: existingSource,
        payload: input.payload,
        now: Date.now(),
      }).pipe(
        Effect.mapError((cause) =>
          sourceOps.update.badRequest(
            "Invalid source definition",
            cause instanceof Error ? cause.message : String(cause),
          ),
        ),
      );

      yield* mapPersistenceError(
        sourceOps.update.child("persist"),
        persistSource(store, updatedSource),
      );

      return yield* syncArtifactsForSource({
        store,
        source: updatedSource,
        operation: sourceOps.update,
      });
    }));

export const connectMcpSource = (input: {
  workspaceId: WorkspaceId;
  payload: ConnectMcpSourcePayload;
}) =>
  Effect.gen(function* () {
    const sourceAuthService = yield* RuntimeSourceAuthServiceTag;

    return yield* sourceAuthService.connectMcpSource({
      workspaceId: input.workspaceId,
      sourceId: input.payload.sourceId,
      endpoint: input.payload.endpoint,
      name: input.payload.name,
      namespace: input.payload.namespace,
      enabled: input.payload.enabled,
      transport: input.payload.transport,
      queryParams: input.payload.queryParams,
      headers: input.payload.headers,
    }).pipe(
      Effect.mapError((cause) => {
        if (cause instanceof Error && cause.message.startsWith("Source not found:")) {
          return sourceOps.connectMcp.notFound(
            "Source not found",
            `workspaceId=${input.workspaceId} sourceId=${input.payload.sourceId}`,
          );
        }

        return sourceOps.connectMcp.unknownStorage(
          cause,
          "Failed preparing MCP source OAuth flow",
        );
      }),
    );
  });

export const removeSource = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      yield* sourceOps.remove.child("artifacts").mapStorage(
        store.toolArtifacts.removeByWorkspaceAndSourceId(input.workspaceId, input.sourceId),
      );

      const removed = yield* sourceOps.remove.mapStorage(
        removeSourceById(store, {
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
        }),
      );

      return { removed };
    })
  );
