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

import {
  WorkOSVaultClientInstantiationError,
  WorkOSVaultClientError,
  makeConfiguredWorkOSVaultClient,
  type WorkOSVaultCredentials,
  type WorkOSVaultClient,
  type WorkOSVaultObject,
} from "./client";

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

export interface ConfiguredWorkOSVaultSecretStoreOptions {
  readonly credentials: WorkOSVaultCredentials;
  readonly metadataStore: ScopedKv;
  readonly objectPrefix?: string;
  readonly scopeId: string;
}

const unwrapVaultError = (error: unknown): unknown =>
  error instanceof WorkOSVaultClientError ? error.cause : error;

const isStatusError = (error: unknown, status: number): boolean => {
  const cause = unwrapVaultError(error);

  return (
    ((cause instanceof GenericServerException || cause instanceof NotFoundException) &&
      cause.status === status) ||
    (typeof cause === "object" &&
      cause !== null &&
      "status" in cause &&
      typeof cause.status === "number" &&
      cause.status === status)
  );
};

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

const loadSecretObject = (
  client: WorkOSVaultClient,
  prefix: string,
  scopeId: string,
  secretId: string,
): Effect.Effect<WorkOSVaultObject | null, WorkOSVaultClientError, never> =>
  client.readObjectByName(secretObjectName(prefix, scopeId, secretId)).pipe(
    Effect.catchAll((error) => (isStatusError(error, 404) ? Effect.succeed(null) : Effect.fail(error))),
  );

const upsertSecretValue = (
  client: WorkOSVaultClient,
  prefix: string,
  scopeId: string,
  secretId: string,
  value: string,
): Effect.Effect<void, WorkOSVaultClientError, never> => {
  const attemptWrite = (
    remainingAttempts: number,
  ): Effect.Effect<void, WorkOSVaultClientError, never> =>
    Effect.gen(function* () {
      const existing = yield* loadSecretObject(client, prefix, scopeId, secretId);

      if (existing) {
        yield* client.updateObject({
          id: existing.id,
          value,
          versionCheck: existing.metadata.versionId,
        });
        return;
      }

      yield* client.createObject({
        name: secretObjectName(prefix, scopeId, secretId),
        value,
        context: objectContext(scopeId),
      });
    }).pipe(
      Effect.catchAll((error) => {
        if (remainingAttempts > 1 && isStatusError(error, 409)) {
          return attemptWrite(remainingAttempts - 1);
        }

        return Effect.fail(error);
      }),
    );

  return attemptWrite(MAX_WRITE_ATTEMPTS);
};

const deleteSecretValue = (
  client: WorkOSVaultClient,
  prefix: string,
  scopeId: string,
  secretId: string,
): Effect.Effect<boolean, WorkOSVaultClientError, never> =>
  Effect.gen(function* () {
    const existing = yield* loadSecretObject(client, prefix, scopeId, secretId);
    if (!existing) return false;

    yield* client.deleteObject({ id: existing.id });
    return true;
  });

const formatVaultError = (error: unknown): string => {
  const cause = unwrapVaultError(error);
  return cause instanceof Error ? cause.message : String(cause);
};

const mapVaultError = (secretId: SecretId, error: unknown): SecretResolutionError =>
  new SecretResolutionError({
    secretId,
    message: formatVaultError(error),
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

        const object = yield* loadSecretObject(options.client, prefix, options.scopeId, secretId).pipe(
          Effect.mapError((error) => mapVaultError(secretId, error)),
        );

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

        const object = yield* loadSecretObject(options.client, prefix, options.scopeId, secretId).pipe(
          Effect.orDie,
        );

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

        yield* upsertSecretValue(options.client, prefix, options.scopeId, input.id, input.value).pipe(
          Effect.mapError((error) => mapVaultError(input.id, error)),
        );

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

        yield* deleteSecretValue(options.client, prefix, options.scopeId, secretId).pipe(Effect.orDie);

        yield* options.metadataStore.delete([secretId]).pipe(Effect.orDie);

        return true;
      }),

    addProvider: (_provider) => Effect.succeed(undefined),

    providers: () => Effect.succeed([WORKOS_VAULT_PROVIDER_KEY] as const),
  };
};

export const makeConfiguredWorkOSVaultSecretStore = (
  options: ConfiguredWorkOSVaultSecretStoreOptions,
): Effect.Effect<
  Context.Tag.Service<typeof SecretStore>,
  WorkOSVaultClientInstantiationError,
  never
> =>
  makeConfiguredWorkOSVaultClient(options.credentials).pipe(
    Effect.map((client) =>
      makeWorkOSVaultSecretStore({
        client,
        metadataStore: options.metadataStore,
        objectPrefix: options.objectPrefix,
        scopeId: options.scopeId,
      }),
    ),
    Effect.withSpan("workos_vault.make_secret_store"),
  );
