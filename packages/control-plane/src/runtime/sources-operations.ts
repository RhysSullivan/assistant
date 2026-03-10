import type {
  CreateSourcePayload,
  UpdateSourcePayload,
} from "../api/sources/api";
import { Actor } from "#domain";
import {
  type AccountId,
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
import { getSourceAdapterForSource } from "./source-adapters";
import {
  mapPersistenceError,
} from "./operations-shared";
import {
  operationErrors,
} from "./operation-errors";
import { createDefaultSecretMaterialResolver } from "./secret-material-providers";
import { ControlPlaneStore, type ControlPlaneStoreShape } from "./store";
import { syncSourceMaterialization } from "./source-materialization";
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
  remove: operationErrors("sources.remove"),
} as const;

const shouldAutoProbeSource = (source: Source): boolean =>
  getSourceAdapterForSource(source).shouldAutoProbe(source);

const syncArtifactsForSource = (input: {
  store: ControlPlaneStoreShape;
  source: Source;
  actorAccountId: AccountId;
  operation:
    | typeof sourceOps.create
    | typeof sourceOps.update;
}) =>
  Effect.gen(function* () {
    const resolveSecretMaterial = createDefaultSecretMaterialResolver({
      rows: input.store,
    });

    // For HTTP-backed source kinds that can validate themselves from a remote
    // document, automatically attempt to probe and connect. This mirrors the
    // addExecutorSource flow by overriding status to "connected" so the sync
    // guard passes.
    const autoProbe = shouldAutoProbeSource(input.source);
    const sourceForSync = autoProbe
      ? { ...input.source, status: "connected" as const }
      : input.source;

    const synced = yield* Effect.either(
      syncSourceMaterialization({
        rows: input.store,
        source: sourceForSync,
        resolveSecretMaterial,
      }),
    );

    return yield* Either.match(synced, {
      onRight: () =>
        Effect.gen(function* () {
          if (autoProbe) {
            const connectedSource = yield* updateSourceFromPayload({
              source: input.source,
              payload: { status: "connected", lastError: null },
              now: Date.now(),
            }).pipe(
              Effect.mapError((cause) =>
                input.operation.badRequest(
                  "Failed updating source status",
                  cause instanceof Error ? cause.message : String(cause),
                ),
              ),
            );
            yield* mapPersistenceError(
              input.operation.child("source_connected"),
              persistSource(input.store, connectedSource, {
                actorAccountId: input.actorAccountId,
              }),
            );
            return connectedSource;
          }
          return input.source;
        }),
      onLeft: (error) =>
        Effect.gen(function* () {
          if (autoProbe || (input.source.enabled && input.source.status === "connected")) {
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
              persistSource(input.store, erroredSource, {
                actorAccountId: input.actorAccountId,
              }),
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
    Effect.flatMap(Actor, (actor) =>
      loadSourcesInWorkspace(store, workspaceId, {
        actorAccountId: actor.principal.accountId,
      }).pipe(
        Effect.mapError((error) =>
          sourceOps.list.unknownStorage(
            error,
            "Failed projecting stored sources",
          ),
        ),
      ),
    ));

export const createSource = (input: {
  workspaceId: WorkspaceId;
  payload: CreateSourcePayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(Actor, (actor) =>
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
          persistSource(store, source, {
            actorAccountId: actor.principal.accountId,
          }),
        );

        return yield* syncArtifactsForSource({
          store,
          source,
          actorAccountId: actor.principal.accountId,
          operation: sourceOps.create,
        });
      }),
    ));

export const getSource = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(Actor, (actor) =>
      loadSourceById(store, {
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
        actorAccountId: actor.principal.accountId,
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
      ),
    ));

export const updateSource = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  payload: UpdateSourcePayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(Actor, (actor) =>
      Effect.gen(function* () {
        const existingSource = yield* loadSourceById(store, {
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
          actorAccountId: actor.principal.accountId,
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
          persistSource(store, updatedSource, {
            actorAccountId: actor.principal.accountId,
          }),
        );

        return yield* syncArtifactsForSource({
          store,
          source: updatedSource,
          actorAccountId: actor.principal.accountId,
          operation: sourceOps.update,
        });
      }),
    ));

export const removeSource = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      const removed = yield* sourceOps.remove.mapStorage(
        removeSourceById(store, {
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
        }),
      );

      return { removed };
    })
  );
