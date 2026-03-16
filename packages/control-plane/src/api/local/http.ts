import {
  HttpApiBuilder,
} from "@effect/platform";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SecretMaterialIdSchema } from "#schema";
import {
  getLocalInstallation,
} from "../../runtime/local-operations";
import { requireRuntimeLocalWorkspace } from "../../runtime/local-runtime-context";
import {
  createDefaultSecretMaterialDeleter,
  createDefaultSecretMaterialStorer,
  createDefaultSecretMaterialUpdater,
  ENV_SECRET_PROVIDER_ID,
  KEYCHAIN_SECRET_PROVIDER_ID,
  LOCAL_SECRET_PROVIDER_ID,
  parseSecretStoreProviderId,
  resolveDefaultSecretStoreProviderId,
} from "../../runtime/secret-material-providers";
import { RuntimeSourceStoreService } from "../../runtime/source-store";
import { ControlPlaneStore } from "../../runtime/store";
import type {
  CreateSecretResult,
  InstanceConfig,
  SecretProvider,
  UpdateSecretResult,
} from "./api";

import { ControlPlaneApi } from "../api";
import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "../errors";

const SECRET_STORE_PROVIDER_ENV = "EXECUTOR_SECRET_STORE_PROVIDER";

const getInstanceConfig = (): Effect.Effect<InstanceConfig> => {
  const explicitDefaultStoreProvider =
    parseSecretStoreProviderId(process.env[SECRET_STORE_PROVIDER_ENV]);
  const providers: SecretProvider[] = [
    {
      id: LOCAL_SECRET_PROVIDER_ID,
      name: "Local store",
      canStore: true,
    },
  ];

  if (process.platform === "darwin" || process.platform === "linux") {
    providers.push({
      id: KEYCHAIN_SECRET_PROVIDER_ID,
      name: process.platform === "darwin" ? "macOS Keychain" : "Desktop Keyring",
      canStore:
        process.platform === "darwin"
        || explicitDefaultStoreProvider === KEYCHAIN_SECRET_PROVIDER_ID,
    });
  }

  providers.push({
    id: ENV_SECRET_PROVIDER_ID,
    name: "Environment variable",
    canStore: false,
  });

  return resolveDefaultSecretStoreProviderId({
    storeProviderId: explicitDefaultStoreProvider ?? undefined,
  }).pipe(
    Effect.map((resolvedDefaultStoreProvider) => ({
      platform: process.platform,
      secretProviders: providers,
      defaultSecretStoreProvider: resolvedDefaultStoreProvider,
    })),
  );
};

const storageError = (message: string) =>
  new ControlPlaneStorageError({
    operation: "secrets",
    message,
    details: message,
  });

export const ControlPlaneLocalLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "local",
  (handlers) =>
    handlers
      .handle("installation", () =>
        getLocalInstallation(),
      )
      .handle("config", () =>
        getInstanceConfig(),
      )
        .handle("listSecrets", () =>
          Effect.gen(function* () {
            const store = yield* ControlPlaneStore;
            const sourceStore = yield* RuntimeSourceStoreService;
            const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace().pipe(
              Effect.mapError(() => storageError("Failed resolving local workspace.")),
            );
            const rows = yield* store.secretMaterials.listAll().pipe(
              Effect.mapError(() => storageError("Failed listing secrets.")),
            );
            const linkedSourcesMap = yield* sourceStore.listLinkedSecretSourcesInWorkspace(
              runtimeLocalWorkspace.installation.workspaceId,
              {
                actorAccountId: runtimeLocalWorkspace.installation.accountId,
              },
            ).pipe(
              Effect.mapError(() => storageError("Failed loading linked sources.")),
            );
            return rows.map((row) => ({
              ...row,
              linkedSources: linkedSourcesMap.get(row.id) ?? [],
            }));
          }),
      )
      .handle("createSecret", ({ payload }) =>
        Effect.gen(function* () {
          const name = payload.name.trim();
          const value = payload.value;
          const purpose = payload.purpose ?? "auth_material";
          const requestedProviderId = payload.providerId === undefined
            ? null
            : parseSecretStoreProviderId(payload.providerId);

          if (name.length === 0) {
            return yield* Effect.fail(
              new ControlPlaneBadRequestError({
                operation: "secrets.create",
                message: "Secret name is required.",
                details: "Secret name is required.",
              }),
            );
          }
          if (payload.providerId !== undefined && requestedProviderId === null) {
            return yield* Effect.fail(
              new ControlPlaneBadRequestError({
                operation: "secrets.create",
                message: `Unsupported secret provider: ${payload.providerId}`,
                details: `Unsupported secret provider: ${payload.providerId}`,
              }),
            );
          }

          const store = yield* ControlPlaneStore;
          const storeSecretMaterial = createDefaultSecretMaterialStorer({
            rows: store,
            ...(requestedProviderId ? { storeProviderId: requestedProviderId } : {}),
          });
          const ref = yield* storeSecretMaterial({
            name,
            purpose,
            value,
          }).pipe(
            Effect.mapError((cause) => storageError(
              cause instanceof Error ? cause.message : "Failed creating secret.",
            )),
          );
          const secretId = SecretMaterialIdSchema.make(ref.handle);
          const created = yield* store.secretMaterials.getById(secretId).pipe(
            Effect.mapError(() => storageError("Failed loading created secret.")),
          );

          if (Option.isNone(created)) {
            return yield* Effect.fail(storageError(`Created secret not found: ${ref.handle}`));
          }

          return {
            id: created.value.id,
            name: created.value.name,
            providerId: created.value.providerId,
            purpose: created.value.purpose,
            createdAt: created.value.createdAt,
            updatedAt: created.value.updatedAt,
          } satisfies CreateSecretResult;
        }),
      )
      .handle("updateSecret", ({ path, payload }) =>
        Effect.gen(function* () {
          const secretId = SecretMaterialIdSchema.make(path.secretId);
          const store = yield* ControlPlaneStore;

          const existing = yield* store.secretMaterials.getById(secretId).pipe(
            Effect.mapError(() => storageError("Failed looking up secret.")),
          );

          if (Option.isNone(existing)) {
            return yield* Effect.fail(
              new ControlPlaneNotFoundError({
                operation: "secrets.update",
                message: `Secret not found: ${path.secretId}`,
                details: `Secret not found: ${path.secretId}`,
              }),
            );
          }

          const update: { name?: string | null; value?: string } = {};
          if (payload.name !== undefined) update.name = payload.name.trim() || null;
          if (payload.value !== undefined) update.value = payload.value;

          const updateSecretMaterial = createDefaultSecretMaterialUpdater({
            rows: store,
          });
          const updated = yield* updateSecretMaterial({
            ref: {
              providerId: existing.value.providerId,
              handle: existing.value.id,
            },
            ...update,
          }).pipe(
            Effect.mapError(() => storageError("Failed updating secret.")),
          );

          return {
            id: updated.id,
            providerId: updated.providerId,
            name: updated.name,
            purpose: updated.purpose,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          } satisfies UpdateSecretResult;
        }),
      )
      .handle("deleteSecret", ({ path }) =>
        Effect.gen(function* () {
          const secretId = SecretMaterialIdSchema.make(path.secretId);
          const store = yield* ControlPlaneStore;

          const existing = yield* store.secretMaterials.getById(secretId).pipe(
            Effect.mapError(() => storageError("Failed looking up secret.")),
          );

          if (Option.isNone(existing)) {
            return yield* Effect.fail(
              new ControlPlaneNotFoundError({
                operation: "secrets.delete",
                message: `Secret not found: ${path.secretId}`,
                details: `Secret not found: ${path.secretId}`,
              }),
            );
          }

          const deleteSecretMaterial = createDefaultSecretMaterialDeleter({
            rows: store,
          });
          const removed = yield* deleteSecretMaterial({
            providerId: existing.value.providerId,
            handle: existing.value.id,
          }).pipe(
            Effect.mapError(() => storageError("Failed removing secret.")),
          );

          if (!removed) {
            return yield* Effect.fail(storageError(`Failed removing secret: ${path.secretId}`));
          }

          return { removed: true };
        }),
      ),
);
