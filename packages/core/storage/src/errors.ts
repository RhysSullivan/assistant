import { Data } from "effect";

import type { StorageCapabilities } from "./types";

export class StorageModelError extends Data.TaggedError("StorageModelError")<{
  readonly model: string;
  readonly message: string;
}> {}

export class StorageFieldError extends Data.TaggedError("StorageFieldError")<{
  readonly model: string;
  readonly field: string;
  readonly message: string;
}> {}

export class StorageQueryError extends Data.TaggedError("StorageQueryError")<{
  readonly model: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class StorageCapabilityError extends Data.TaggedError("StorageCapabilityError")<{
  readonly adapterId: string;
  readonly capability: keyof StorageCapabilities;
  readonly message: string;
}> {}

export class StorageTransactionError extends Data.TaggedError("StorageTransactionError")<{
  readonly adapterId: string;
  readonly cause: unknown;
}> {}

export type StorageError =
  | StorageModelError
  | StorageFieldError
  | StorageQueryError
  | StorageCapabilityError
  | StorageTransactionError;
