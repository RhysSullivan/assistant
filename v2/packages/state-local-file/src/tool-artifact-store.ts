import * as FileSystem from "@effect/platform/FileSystem";
import * as PlatformError from "@effect/platform/Error";
import * as Path from "@effect/platform/Path";
import {
  ToolArtifactStoreError,
  ToolArtifactStoreService,
  type ToolArtifactStore,
} from "@executor-v2/persistence-ports";
import {
  ToolArtifactSchema,
  type SourceId,
  type ToolArtifact,
  type WorkspaceId,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as STM from "effect/STM";
import * as TSemaphore from "effect/TSemaphore";

const ToolArtifactListSchema = Schema.Array(ToolArtifactSchema);
const ToolArtifactListFromJsonSchema = Schema.parseJson(ToolArtifactListSchema);
const decodeArtifactsFromJson = Schema.decodeUnknown(ToolArtifactListFromJsonSchema);
const encodeArtifactsToJson = Schema.encode(ToolArtifactListFromJsonSchema);

export type LocalToolArtifactStoreOptions = {
  rootDir: string;
};

const defaultArtifactsFilePath = (path: Path.Path, rootDir: string): string =>
  path.resolve(rootDir, "tool-artifacts.json");

const toSystemPersistenceError = (
  operation: string,
  filePath: string,
  cause: PlatformError.SystemError,
): ToolArtifactStoreError =>
  new ToolArtifactStoreError({
    operation,
    filePath,
    message: cause.message,
    reason: cause.reason,
    details: cause.description ?? null,
  });

const toBadArgumentPersistenceError = (
  operation: string,
  filePath: string,
  cause: PlatformError.BadArgument,
): ToolArtifactStoreError =>
  new ToolArtifactStoreError({
    operation,
    filePath,
    message: cause.message,
    reason: null,
    details: cause.description ?? null,
  });

const withPlatformPersistenceError =
  <A>(operation: string, filePath: string) =>
  (
    self: Effect.Effect<A, PlatformError.PlatformError>,
  ): Effect.Effect<A, ToolArtifactStoreError> =>
    pipe(
      self,
      Effect.catchTags({
        SystemError: (cause) =>
          Effect.fail(toSystemPersistenceError(operation, filePath, cause)),
        BadArgument: (cause) =>
          Effect.fail(toBadArgumentPersistenceError(operation, filePath, cause)),
      }),
    );
const toSchemaPersistenceError = (
  operation: string,
  filePath: string,
  cause: ParseResult.ParseError,
): ToolArtifactStoreError =>
  new ToolArtifactStoreError({
    operation,
    filePath,
    message: "Invalid persisted tool artifact payload",
    reason: "InvalidData",
    details: ParseResult.TreeFormatter.formatErrorSync(cause),
  });

const artifactStoreKey = (artifact: ToolArtifact): string =>
  `${artifact.workspaceId}:${artifact.sourceId}`;

const dedupeArtifacts = (artifacts: ReadonlyArray<ToolArtifact>): Array<ToolArtifact> => {
  const byKey = new Map<string, ToolArtifact>();
  for (const artifact of artifacts) {
    byKey.set(artifactStoreKey(artifact), artifact);
  }
  return Array.from(byKey.values());
};

const readArtifacts = (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<Array<ToolArtifact>, ToolArtifactStoreError> =>
  pipe(
    fileSystem.readFileString(filePath),
    Effect.catchTag("SystemError", (cause) =>
      cause.reason === "NotFound" ? Effect.succeed("[]") : Effect.fail(cause),
    ),
    withPlatformPersistenceError("read", filePath),
    Effect.flatMap((rawJson) =>
      pipe(
        decodeArtifactsFromJson(rawJson.trim().length === 0 ? "[]" : rawJson),
        Effect.map((artifacts) => dedupeArtifacts(Array.from(artifacts))),
        Effect.mapError((cause) => toSchemaPersistenceError("decode", filePath, cause)),
      ),
    ),
  );

const writeArtifacts = (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  filePath: string,
  artifacts: Array<ToolArtifact>,
): Effect.Effect<void, ToolArtifactStoreError> => {
  const directoryPath = path.dirname(filePath);

  return pipe(
    fileSystem.makeDirectory(directoryPath, { recursive: true }),
    withPlatformPersistenceError("mkdir", directoryPath),
    Effect.flatMap(() =>
      pipe(
        encodeArtifactsToJson(artifacts),
        Effect.mapError((cause) => toSchemaPersistenceError("encode", filePath, cause)),
      ),
    ),
    Effect.flatMap((payload) =>
      pipe(
        fileSystem.makeTempFile({
          directory: directoryPath,
          prefix: `${path.basename(filePath)}.tmp-`,
        }),
        withPlatformPersistenceError("makeTempFile", directoryPath),
        Effect.flatMap((tempPath) =>
          pipe(
            fileSystem.writeFileString(tempPath, payload),
            withPlatformPersistenceError("write", tempPath),
            Effect.flatMap(() =>
              pipe(
                fileSystem.rename(tempPath, filePath),
                withPlatformPersistenceError("rename", filePath),
              ),
            ),
          ),
        ),
      ),
    ),
  );
};

export const makeLocalToolArtifactStore = (
  options: LocalToolArtifactStoreOptions,
): Effect.Effect<ToolArtifactStore, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const writeSemaphore = yield* STM.commit(TSemaphore.make(1));
    const filePath = defaultArtifactsFilePath(path, options.rootDir);

    return {
      getBySource: (workspaceId: WorkspaceId, sourceId: SourceId) =>
        pipe(
          readArtifacts(fileSystem, filePath),
          Effect.map((artifacts) =>
            Option.fromNullable(
              artifacts.find(
                (artifact) =>
                  artifact.workspaceId === workspaceId && artifact.sourceId === sourceId,
              ),
            ),
          ),
        ),

      upsert: (artifact: ToolArtifact) =>
        pipe(
          readArtifacts(fileSystem, filePath),
          Effect.map((artifacts) => {
            const byKey = new Map<string, ToolArtifact>(
              artifacts.map((currentArtifact) => [
                artifactStoreKey(currentArtifact),
                currentArtifact,
              ]),
            );
            byKey.set(artifactStoreKey(artifact), artifact);
            return Array.from(byKey.values());
          }),
          Effect.flatMap((nextArtifacts) =>
            writeArtifacts(fileSystem, path, filePath, nextArtifacts),
          ),
          TSemaphore.withPermit(writeSemaphore),
        ),
    };
  });

export const LocalToolArtifactStoreLive = (
  options: LocalToolArtifactStoreOptions,
): Layer.Layer<
  ToolArtifactStoreService,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Layer.effect(ToolArtifactStoreService, makeLocalToolArtifactStore(options));

