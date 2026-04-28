import { Data, Effect } from "effect";

import {
  WorkOSVaultClientError,
  type WorkOSVaultClient,
  type WorkOSVaultObject,
  type WorkOSVaultObjectMetadata,
  type WorkOSVaultSdk,
} from "./client";

export class TestWorkOSVaultNotFoundError extends Data.TaggedError("TestWorkOSVaultNotFoundError")<{
  readonly message: string;
  readonly status: 404;
}> {}

export class TestWorkOSVaultConflictError extends Data.TaggedError("TestWorkOSVaultConflictError")<{
  readonly message: string;
  readonly status: 409;
}> {}

export class TestWorkOSVaultInvalidRequestError extends Data.TaggedError(
  "TestWorkOSVaultInvalidRequestError",
)<{
  readonly message: string;
  readonly status: 400;
}> {}

type TestWorkOSVaultError =
  | TestWorkOSVaultNotFoundError
  | TestWorkOSVaultConflictError
  | TestWorkOSVaultInvalidRequestError;

export interface TestWorkOSVaultClientOptions {
  /**
   * Injects a single 409 on the next update against an object whose name
   * ends in `/secrets/conflict`. The retry path should then re-read and
   * succeed.
   */
  readonly conflictOnNextSecretUpdate?: boolean;
  readonly rejectNamesWithColon?: boolean;
  readonly rejectReadNamesLongerThan?: number;
}

const makeMetadata = (
  id: string,
  context: Record<string, string>,
  versionId: string = `${id}-v1`,
): WorkOSVaultObjectMetadata => ({
  id,
  context,
  updatedAt: new Date(),
  versionId,
});

const notFound = (message: string) => new TestWorkOSVaultNotFoundError({ message, status: 404 });

const conflict = (message: string) => new TestWorkOSVaultConflictError({ message, status: 409 });

const invalidRequest = (message: string) =>
  new TestWorkOSVaultInvalidRequestError({ message, status: 400 });

export const makeTestWorkOSVaultClient = (
  options?: TestWorkOSVaultClientOptions,
): WorkOSVaultClient => {
  const objects = new Map<string, WorkOSVaultObject>();
  let sequence = 0;
  let conflictPending = options?.conflictOnNextSecretUpdate ?? false;

  const nextId = () => `obj_${(sequence += 1)}`;

  const validateObjectName = (name: string): Effect.Effect<void, TestWorkOSVaultError> => {
    if (options?.rejectNamesWithColon && name.includes(":")) {
      return Effect.fail(invalidRequest(`Invalid object name "${name}"`));
    }
    return Effect.void;
  };

  const validateReadName = (name: string): Effect.Effect<void, TestWorkOSVaultError> =>
    Effect.gen(function* () {
      yield* validateObjectName(name);

      if (
        options?.rejectReadNamesLongerThan !== undefined &&
        name.length > options.rejectReadNamesLongerThan
      ) {
        return yield* invalidRequest(`Invalid object name "${name}"`);
      }
    });

  const createObject = (options: {
    readonly name: string;
    readonly value: string;
    readonly context: Record<string, string>;
  }): Effect.Effect<WorkOSVaultObjectMetadata, TestWorkOSVaultError> =>
    Effect.gen(function* () {
      yield* validateObjectName(options.name);
      if (objects.has(options.name)) {
        return yield* conflict(`Object "${options.name}" already exists`);
      }

      const id = nextId();
      const metadata = makeMetadata(id, options.context);
      objects.set(options.name, {
        id,
        name: options.name,
        value: options.value,
        metadata,
      });
      return metadata;
    });

  const readObjectByName = (name: string): Effect.Effect<WorkOSVaultObject, TestWorkOSVaultError> =>
    Effect.gen(function* () {
      yield* validateReadName(name);
      const object = objects.get(name);
      if (!object) {
        return yield* notFound(`Object "${name}" not found`);
      }
      return object;
    });

  const updateObject = (options: {
    readonly id: string;
    readonly value: string;
    readonly versionCheck?: string;
  }): Effect.Effect<WorkOSVaultObject, TestWorkOSVaultError> =>
    Effect.gen(function* () {
      const current = [...objects.values()].find((o) => o.id === options.id);
      if (!current) {
        return yield* notFound(`Object "${options.id}" not found`);
      }
      if (conflictPending && current.name.endsWith("/secrets/conflict")) {
        conflictPending = false;
        return yield* conflict(`Injected conflict for "${options.id}"`);
      }
      if (options.versionCheck && current.metadata.versionId !== options.versionCheck) {
        return yield* conflict(`Version mismatch for "${options.id}"`);
      }

      const nextVersion = current.metadata.versionId.replace(
        /v(\d+)$/,
        (_, version) => `v${Number(version) + 1}`,
      );
      const next: WorkOSVaultObject = {
        ...current,
        value: options.value,
        metadata: {
          ...current.metadata,
          updatedAt: new Date(),
          versionId: nextVersion,
        },
      };
      objects.set(current.name, next);
      return next;
    });

  const deleteObject = (options: {
    readonly id: string;
  }): Effect.Effect<void, TestWorkOSVaultError> =>
    Effect.gen(function* () {
      const entry = [...objects.entries()].find(([, object]) => object.id === options.id);
      if (!entry) {
        return yield* notFound(`Object "${options.id}" not found`);
      }
      objects.delete(entry[0]);
    });

  const wrap = <A>(
    operation: string,
    effect: Effect.Effect<A, TestWorkOSVaultError>,
  ): Effect.Effect<A, WorkOSVaultClientError> =>
    effect.pipe(
      Effect.mapError((cause) => new WorkOSVaultClientError({ cause, operation })),
      Effect.withSpan(`workos_vault.test.${operation}`),
    );

  const rawClient: WorkOSVaultSdk = {
    createObject: (options) => Effect.runPromise(createObject(options)),
    readObjectByName: (name) => Effect.runPromise(readObjectByName(name)),
    updateObject: (options) => Effect.runPromise(updateObject(options)),
    deleteObject: (options) => Effect.runPromise(deleteObject(options)),
  };

  return {
    use: (operation, fn) =>
      Effect.tryPromise({
        try: () => fn(rawClient),
        catch: (cause) => new WorkOSVaultClientError({ cause, operation }),
      }).pipe(Effect.withSpan(`workos_vault.test.${operation}`)),
    createObject: (options) => wrap("create_object", createObject(options)),
    readObjectByName: (name) => wrap("read_object_by_name", readObjectByName(name)),
    updateObject: (options) => wrap("update_object", updateObject(options)),
    deleteObject: (options) => wrap("delete_object", deleteObject(options)),
  };
};
