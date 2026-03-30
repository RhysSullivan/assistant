import { FileSystem } from "@effect/platform";
import * as Effect from "effect/Effect";

import type { ResolvedLocalWorkspaceContext } from "../config";
import {
  decodeLocalExecutorStateSnapshot,
  encodeLocalExecutorStateSnapshot,
  localExecutorStatePath,
  LOCAL_EXECUTOR_STATE_VERSION,
  type LocalExecutorStateSnapshot,
} from "../executor-state-codec";
import {
  LocalFileSystemError,
  unknownLocalErrorDetails,
} from "../errors";
import { deriveLocalInstallation } from "../installation";

const LEGACY_EXECUTOR_STATE_BACKUP_SUFFIX = ".legacy-backup";
const LEGACY_LOCAL_SECRET_STORE_ID = "sts_builtin_local";
const LEGACY_KEYCHAIN_SECRET_STORE_ID = "sts_builtin_keychain";

const mapFileSystemError = (path: string, action: string) => (cause: unknown) =>
  new LocalFileSystemError({
    message: `Failed to ${action} ${path}: ${unknownLocalErrorDetails(cause)}`,
    action,
    path,
    details: unknownLocalErrorDetails(cause),
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asNullableString = (value: unknown): string | null =>
  value === null
    ? null
    : typeof value === "string"
      ? value
      : null;

const asBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const legacySecretStoreIdForProviderId = (providerId: string): string =>
  providerId === "local"
    ? LEGACY_LOCAL_SECRET_STORE_ID
    : providerId === "keychain"
      ? LEGACY_KEYCHAIN_SECRET_STORE_ID
      : `sts_legacy_${providerId}`;

const legacySecretStoreNameForProviderId = (providerId: string): string => {
  switch (providerId) {
    case "local":
      return "Local Store";
    case "keychain":
      return process.platform === "darwin"
        ? "macOS Keychain"
        : process.platform === "win32"
          ? "Windows Credential Manager"
          : "Desktop Keyring";
    default:
      return `Legacy ${providerId}`;
  }
};

const migrateLegacyExecutorStateValue = (
  value: unknown,
): {
  value: unknown;
  migrated: boolean;
} => {
  if (Array.isArray(value)) {
    let migrated = false;
    const next = value.map((item) => {
      const result = migrateLegacyExecutorStateValue(item);
      migrated ||= result.migrated;
      return result.value;
    });
    return { value: next, migrated };
  }

  const record = asRecord(value);
  if (record === null) {
    return { value, migrated: false };
  }

  let migrated = false;
  const next: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    let nextKey = key;
    if (key === "workspaceId") {
      nextKey = "scopeId";
      migrated = true;
    } else if (key === "actorAccountId") {
      nextKey = "actorScopeId";
      migrated = true;
    } else if (key === "createdByAccountId") {
      nextKey = "createdByScopeId";
      migrated = true;
    } else if (key === "workspaceOauthClients") {
      nextKey = "scopeOauthClients";
      migrated = true;
    }

    const migratedEntry = migrateLegacyExecutorStateValue(entry);
    migrated ||= migratedEntry.migrated;
    next[nextKey] = migratedEntry.value;
  }

  return { value: next, migrated };
};

const normalizeLegacySecretStore = (input: {
  scopeId: string;
  record: Record<string, unknown>;
}) => {
  const id = asString(input.record.id);
  const kind = asString(input.record.kind);
  if (!id || !kind) {
    return null;
  }

  const createdAt = asFiniteNumber(input.record.createdAt) ?? 0;
  const updatedAt = asFiniteNumber(input.record.updatedAt) ?? createdAt;

  return {
    id,
    scopeId: asString(input.record.scopeId) ?? input.scopeId,
    name: asString(input.record.name) ?? legacySecretStoreNameForProviderId(kind),
    kind,
    status:
      input.record.status === "connected" || input.record.status === "error"
        ? input.record.status
        : kind === "local" || kind === "keychain"
          ? "connected"
          : "error",
    enabled: asBoolean(input.record.enabled) ?? true,
    createdAt,
    updatedAt,
  };
};

const legacySecretStoredData = (input: {
  material: Record<string, unknown>;
  storeKind: string | null;
}) => {
  const handle = asString(input.material.handle);
  const value = asNullableString(input.material.value);

  switch (input.storeKind) {
    case "local":
      return value !== null ? { value } : null;
    case "keychain":
      return handle ? { account: handle } : null;
    default:
      return handle !== null || value !== null
        ? {
            ...(handle !== null ? { handle } : {}),
            ...(value !== null ? { value } : {}),
          }
        : null;
  }
};

const canDecodeCurrentExecutorStateSnapshot = (value: unknown): boolean => {
  try {
    decodeLocalExecutorStateSnapshot(value);
    return true;
  } catch {
    return false;
  }
};

const decodeLegacyExecutorStateSnapshot = (input: {
  scopeId: string;
  value: unknown;
}): LocalExecutorStateSnapshot => {
  const root = asRecord(input.value);
  if (root === null) {
    return decodeLocalExecutorStateSnapshot(input.value);
  }

  const secretStores = new Map<string, Record<string, unknown>>();
  for (const entry of Array.isArray(root.secretStores) ? root.secretStores : []) {
    const record = asRecord(entry);
    const normalized = record
      ? normalizeLegacySecretStore({
          scopeId: input.scopeId,
          record,
        })
      : null;
    if (normalized) {
      secretStores.set(normalized.id, normalized);
    }
  }

  const secretMaterialStoredData = new Map<string, { secretId: string; data: unknown }>();
  for (const entry of Array.isArray(root.secretMaterialStoredData)
    ? root.secretMaterialStoredData
    : []) {
    const record = asRecord(entry);
    const secretId = asString(record?.secretId);
    if (!secretId) {
      continue;
    }
    secretMaterialStoredData.set(secretId, {
      secretId,
      data: record?.data,
    });
  }

  const secretMaterials = (Array.isArray(root.secretMaterials)
    ? root.secretMaterials
    : []
  ).flatMap((entry) => {
    const record = asRecord(entry);
    const id = asString(record?.id);
    const purpose = asString(record?.purpose);
    if (!record || !id || !purpose) {
      return [];
    }

    const providerId = asString(record.providerId);
    const storeId = asString(record.storeId)
      ?? (providerId ? legacySecretStoreIdForProviderId(providerId) : null);
    if (!storeId) {
      return [];
    }

    const createdAt = asFiniteNumber(record.createdAt) ?? 0;
    const updatedAt = asFiniteNumber(record.updatedAt) ?? createdAt;

    if (providerId && !secretStores.has(storeId)) {
      secretStores.set(storeId, {
        id: storeId,
        scopeId: input.scopeId,
        name: legacySecretStoreNameForProviderId(providerId),
        kind: providerId,
        status:
          providerId === "local" || providerId === "keychain"
            ? "connected"
            : "error",
        enabled: true,
        createdAt,
        updatedAt,
      });
    }

    const storeKind = asString(secretStores.get(storeId)?.kind) ?? providerId;
    if (!secretMaterialStoredData.has(id)) {
      const data = legacySecretStoredData({
        material: record,
        storeKind,
      });
      if (data !== null) {
        secretMaterialStoredData.set(id, {
          secretId: id,
          data,
        });
      }
    }

    return [{
      id,
      name: asNullableString(record.name),
      purpose,
      storeId,
      createdAt,
      updatedAt,
    }];
  });

  return decodeLocalExecutorStateSnapshot({
    version: LOCAL_EXECUTOR_STATE_VERSION,
    secretStores: [...secretStores.values()],
    secretMaterials,
    secretMaterialStoredData: [...secretMaterialStoredData.values()],
    executions: Array.isArray(root.executions) ? root.executions : [],
    executionInteractions: Array.isArray(root.executionInteractions)
      ? root.executionInteractions
      : [],
    executionSteps: Array.isArray(root.executionSteps) ? root.executionSteps : [],
  });
};

const migrateLegacyExecutorStateFile = (
  context: ResolvedLocalWorkspaceContext,
): Effect.Effect<boolean, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = localExecutorStatePath(context);
    const exists = yield* fs.exists(path).pipe(
      Effect.mapError(mapFileSystemError(path, "check executor state path")),
    );
    if (!exists) {
      return false;
    }

    const content = yield* fs.readFileString(path, "utf8").pipe(
      Effect.mapError(mapFileSystemError(path, "read executor state")),
    );
    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: mapFileSystemError(path, "parse executor state"),
    });

    if (canDecodeCurrentExecutorStateSnapshot(parsed)) {
      return false;
    }

    const migrated = migrateLegacyExecutorStateValue(parsed);
    const migratedState = yield* Effect.try({
      try: () =>
        decodeLegacyExecutorStateSnapshot({
          scopeId: deriveLocalInstallation(context).scopeId,
          value: migrated.value,
        }),
      catch: mapFileSystemError(path, "decode executor state"),
    });

    const backupPath = `${path}${LEGACY_EXECUTOR_STATE_BACKUP_SUFFIX}`;
    const backupExists = yield* fs.exists(backupPath).pipe(
      Effect.mapError(mapFileSystemError(backupPath, "check executor state backup path")),
    );
    if (!backupExists) {
      yield* fs.writeFileString(backupPath, content, { mode: 0o600 }).pipe(
        Effect.mapError(mapFileSystemError(backupPath, "write executor state backup")),
      );
    }

    yield* fs.writeFileString(
      path,
      encodeLocalExecutorStateSnapshot(migratedState),
      { mode: 0o600 },
    ).pipe(
      Effect.mapError(mapFileSystemError(path, "write migrated executor state")),
    );

    return true;
  });

export const migrateLegacyLocalExecutorState = (
  context: ResolvedLocalWorkspaceContext,
): Effect.Effect<ReadonlyArray<string>, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const migrated = yield* migrateLegacyExecutorStateFile(context);
    return migrated ? [localExecutorStatePath(context)] : [];
  });
