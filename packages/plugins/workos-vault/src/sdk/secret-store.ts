import { type Context, Effect, Option } from "effect";
import { GenericServerException, NotFoundException } from "@workos-inc/node/worker";

import {
  SecretId,
  SecretNotFoundError,
  SecretRef,
  SecretResolutionError,
  type ScopeId,
  type ScopedKv,
  type SecretStore,
  type SetSecretInput,
} from "@executor/sdk";

import type { WorkOSVaultClient, WorkOSVaultObject } from "./client";

export const WORKOS_VAULT_PROVIDER_KEY = "workos-vault";

const DEFAULT_OBJECT_PREFIX = "executor";
const MAX_WRITE_ATTEMPTS = 3;

type StoredSecretRef = {
  readonly createdAt: number;
  readonly name: string;
  readonly purpose?: string;
};

export interface WorkOSVaultSecretStoreOptions {
  readonly client: WorkOSVaultClient;
  readonly metadataStore: ScopedKv;
  readonly objectPrefix?: string;
  readonly scopeId: string;
}

const isStatusError = (error: unknown, status: number): boolean =>
  ((error instanceof GenericServerException || error instanceof NotFoundException) &&
    error.status === status) ||
  (typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status === status);

const objectContext = (scopeId: string): Record<string, string> => ({
  app: "executor",
  organization_id: scopeId,
  scope_id: scopeId,
});

const secretObjectName = (prefix: string, scopeId: string, secretId: string): string =>
  `${prefix}/${scopeId}/secrets/${secretId}`;

const decodeSecretRef = (raw: string | null): StoredSecretRef | null => {
  if (raw === null) return null;

  const parsed = JSON.parse(raw) as Partial<StoredSecretRef>;
  if (typeof parsed.name !== "string" || typeof parsed.createdAt !== "number") return null;

  return {
    name: parsed.name,
    createdAt: parsed.createdAt,
    purpose: typeof parsed.purpose === "string" ? parsed.purpose : undefined,
  };
};

const encodeSecretRef = (secret: StoredSecretRef): string => JSON.stringify(secret);

const toSecretRef = (
  scopeId: ScopeId,
  secretId: string,
  secret: StoredSecretRef,
): SecretRef =>
  new SecretRef({
    id: SecretId.make(secretId),
    scopeId,
    name: secret.name,
    provider: Option.some(WORKOS_VAULT_PROVIDER_KEY),
    purpose: secret.purpose,
    createdAt: new Date(secret.createdAt),
  });

const loadSecretObject = async (
  client: WorkOSVaultClient,
  prefix: string,
  scopeId: string,
  secretId: string,
): Promise<WorkOSVaultObject | null> => {
  try {
    return await client.readObjectByName(secretObjectName(prefix, scopeId, secretId));
  } catch (error) {
    if (isStatusError(error, 404)) return null;
    throw error;
  }
};

const upsertSecretValue = async (
  client: WorkOSVaultClient,
  prefix: string,
  scopeId: string,
  secretId: string,
  value: string,
): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const existing = await loadSecretObject(client, prefix, scopeId, secretId);

    try {
      if (existing) {
        await client.updateObject({
          id: existing.id,
          value,
          versionCheck: existing.metadata.versionId,
        });
      } else {
        await client.createObject({
          name: secretObjectName(prefix, scopeId, secretId),
          value,
          context: objectContext(scopeId),
        });
      }

      return;
    } catch (error) {
      if (isStatusError(error, 409)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error(`Failed to write WorkOS Vault secret "${secretId}"`);
};

const deleteSecretValue = async (
  client: WorkOSVaultClient,
  prefix: string,
  scopeId: string,
  secretId: string,
): Promise<boolean> => {
  const existing = await loadSecretObject(client, prefix, scopeId, secretId);
  if (!existing) return false;

  await client.deleteObject({ id: existing.id });
  return true;
};

const mapVaultError = (secretId: SecretId, error: unknown): SecretResolutionError =>
  new SecretResolutionError({
    secretId,
    message: error instanceof Error ? error.message : String(error),
  });

export const makeWorkOSVaultSecretStore = (
  options: WorkOSVaultSecretStoreOptions,
): Context.Tag.Service<typeof SecretStore> => {
  const prefix = options.objectPrefix ?? DEFAULT_OBJECT_PREFIX;
  const scopeId = options.scopeId as ScopeId;

  return {
    list: (requestedScopeId: ScopeId) =>
      options.metadataStore.list().pipe(
        Effect.orDie,
        Effect.map((entries) =>
          entries
            .map(({ key, value }) => {
              const secret = decodeSecretRef(value);
              return secret ? toSecretRef(requestedScopeId, key, secret) : null;
            })
            .filter((secret): secret is SecretRef => secret !== null)
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
        ),
      ),

    get: (secretId: SecretId) =>
      options.metadataStore.get(secretId).pipe(
        Effect.orDie,
        Effect.flatMap((raw) => {
          const secret = decodeSecretRef(raw);
          if (!secret) return Effect.fail(new SecretNotFoundError({ secretId }));
          return Effect.succeed(toSecretRef(scopeId, secretId, secret));
        }),
      ),

    resolve: (secretId: SecretId, _requestedScopeId: ScopeId) =>
      Effect.gen(function* () {
        const secret = yield* options.metadataStore.get(secretId).pipe(Effect.orDie);
        if (!decodeSecretRef(secret)) {
          return yield* new SecretNotFoundError({ secretId });
        }

        const object = yield* Effect.tryPromise(() =>
          loadSecretObject(options.client, prefix, options.scopeId, secretId),
        ).pipe(Effect.mapError((error) => mapVaultError(secretId, error)));

        if (!object?.value) {
          return yield* new SecretResolutionError({
            secretId,
            message: `Secret "${secretId}" is missing a value`,
          });
        }

        return object.value;
      }),

    status: (secretId: SecretId, _requestedScopeId: ScopeId) =>
      Effect.gen(function* () {
        const secret = yield* options.metadataStore.get(secretId).pipe(Effect.orDie);
        if (!decodeSecretRef(secret)) return "missing" as const;

        const object = yield* Effect.tryPromise(() =>
          loadSecretObject(options.client, prefix, options.scopeId, secretId),
        ).pipe(Effect.orDie);

        return object?.value ? ("resolved" as const) : ("missing" as const);
      }),

    set: (input: SetSecretInput) =>
      Effect.gen(function* () {
        if (input.provider && input.provider !== WORKOS_VAULT_PROVIDER_KEY) {
          return yield* new SecretResolutionError({
            secretId: input.id,
            message: `Only the default secret store is writable in cloud`,
          });
        }

        const existing = yield* options.metadataStore.get(input.id).pipe(Effect.orDie);
        const existingSecret = decodeSecretRef(existing);

        yield* Effect.tryPromise(() =>
          upsertSecretValue(options.client, prefix, options.scopeId, input.id, input.value),
        ).pipe(Effect.mapError((error) => mapVaultError(input.id, error)));

        const storedSecret: StoredSecretRef = {
          createdAt: existingSecret?.createdAt ?? Date.now(),
          name: input.name,
          purpose: input.purpose,
        };

        yield* options.metadataStore
          .set([{ key: input.id, value: encodeSecretRef(storedSecret) }])
          .pipe(Effect.orDie);

        return toSecretRef(input.scopeId, input.id, storedSecret);
      }),

    remove: (secretId: SecretId) =>
      Effect.gen(function* () {
        const secret = yield* options.metadataStore.get(secretId).pipe(Effect.orDie);
        if (!decodeSecretRef(secret)) {
          return yield* new SecretNotFoundError({ secretId });
        }

        yield* Effect.tryPromise(() =>
          deleteSecretValue(options.client, prefix, options.scopeId, secretId),
        ).pipe(Effect.orDie);

        yield* options.metadataStore.delete([secretId]).pipe(Effect.orDie);

        return true;
      }),

    addProvider: (_provider) => Effect.succeed(undefined),

    providers: () => Effect.succeed([WORKOS_VAULT_PROVIDER_KEY] as const),
  };
};
