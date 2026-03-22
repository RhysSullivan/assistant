import * as Data from "effect/Data";

export class RuntimeLocalScopeUnavailableError extends Data.TaggedError(
  "RuntimeLocalScopeUnavailableError",
)<{
  readonly message: string;
}> {}

export class RuntimeLocalScopeMismatchError extends Data.TaggedError(
  "RuntimeLocalScopeMismatchError",
)<{
  readonly message: string;
  readonly requestedScopeId: string;
  readonly activeScopeId: string;
}> {}

export class LocalConfiguredSourceNotFoundError extends Data.TaggedError(
  "LocalConfiguredSourceNotFoundError",
)<{
  readonly message: string;
  readonly sourceId: string;
}> {}

export class LocalSourceArtifactMissingError extends Data.TaggedError(
  "LocalSourceArtifactMissingError",
)<{
  readonly message: string;
  readonly sourceId: string;
}> {}

export class LocalUnsupportedSourceKindError extends Data.TaggedError(
  "LocalUnsupportedSourceKindError",
)<{
  readonly message: string;
  readonly kind: string;
}> {}
