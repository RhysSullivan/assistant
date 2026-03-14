import {
  ControlPlaneBadRequestError,
  ControlPlaneStorageError,
} from "../api/errors";
import { ControlPlanePersistenceError } from "#persistence";
import * as Effect from "effect/Effect";

import {
  asOperationErrors,
  type OperationErrorsLike,
} from "./operation-errors";
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const isUniqueViolation = (error: ControlPlanePersistenceError): boolean =>
  error.kind === "unique_violation";

export const mapPersistenceError = <A>(
  operation: OperationErrorsLike,
  effect: Effect.Effect<A, ControlPlanePersistenceError | Error>,
): Effect.Effect<A, ControlPlaneBadRequestError | ControlPlaneStorageError> =>
  effect.pipe(
    Effect.mapError((error) => {
      const errors = asOperationErrors(operation);
      if (error instanceof ControlPlanePersistenceError) {
        return isUniqueViolation(error)
          ? errors.badRequest("Unique constraint violation", error.details ?? "duplicate key")
          : errors.storage(error);
      }

      return errors.unknownStorage(
        error,
        error.message,
      );
    }),
  );

export const parseJsonString = (
  operation: OperationErrorsLike,
  fieldName: string,
  value: string,
): Effect.Effect<string, ControlPlaneBadRequestError> =>
  Effect.try({
    try: () => {
      JSON.parse(value);
      return value;
    },
    catch: () => {
      const errors = asOperationErrors(operation);
      return errors.badRequest(
        `Invalid ${fieldName}`,
        `${fieldName} must be valid JSON`,
      );
    },
  });
