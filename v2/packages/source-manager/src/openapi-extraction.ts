import { createHash } from "node:crypto";

import {
  ToolArtifactStoreError,
  type ToolArtifactStore,
} from "@executor-v2/persistence-ports";
import {
  ToolArtifactIdSchema,
  type Source,
  type ToolArtifact,
} from "@executor-v2/schema";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

type OpenApiExtractionStage =
  | "validate"
  | "extract"
  | "encode_manifest";

export class OpenApiExtractionError extends Data.TaggedError("OpenApiExtractionError")<{
  sourceName: string;
  stage: OpenApiExtractionStage;
  message: string;
  details: string | null;
}> {}

export const ExtractedToolSchema = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  method: Schema.String,
  path: Schema.String,
  operationHash: Schema.String,
});

export type ExtractedTool = typeof ExtractedToolSchema.Type;

export const ToolManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  sourceHash: Schema.String,
  tools: Schema.Array(ExtractedToolSchema),
});

const ToolManifestFromJsonSchema = Schema.parseJson(ToolManifestSchema);
const encodeManifestToJson = Schema.encode(ToolManifestFromJsonSchema);
const decodeToolArtifactId = Schema.decodeUnknownSync(ToolArtifactIdSchema);

export type ToolManifest = typeof ToolManifestSchema.Type;

export type ToolManifestDiff = {
  added: Array<string>;
  changed: Array<string>;
  removed: Array<string>;
  unchangedCount: number;
};

export type RefreshOpenApiArtifactResult = {
  artifact: ToolArtifact;
  manifest: ToolManifest;
  diff: ToolManifestDiff;
  reused: boolean;
};

export type RefreshOpenApiArtifactInput = {
  source: Source;
  openApiSpec: unknown;
  artifactStore: ToolArtifactStore;
  now?: () => number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }

  if (isRecord(value)) {
    const stableRecord: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      stableRecord[key] = toStableValue(value[key]);
    }
    return stableRecord;
  }

  return value;
};

const hashUnknown = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(toStableValue(value))).digest("hex");

const normalizePathForToolId = (pathValue: string): string =>
  pathValue
    .trim()
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "root";

const buildToolId = (
  method: HttpMethod,
  pathValue: string,
  operation: Record<string, unknown>,
): string => {
  const operationId = operation.operationId;
  if (typeof operationId === "string" && operationId.trim().length > 0) {
    return operationId.trim();
  }

  return `${method}_${normalizePathForToolId(pathValue)}`;
};

const buildToolName = (
  method: HttpMethod,
  pathValue: string,
  operation: Record<string, unknown>,
): string => {
  const summary = operation.summary;
  if (typeof summary === "string" && summary.trim().length > 0) {
    return summary.trim();
  }

  const operationId = operation.operationId;
  if (typeof operationId === "string" && operationId.trim().length > 0) {
    return operationId.trim();
  }

  return `${method.toUpperCase()} ${pathValue}`;
};

const buildToolDescription = (operation: Record<string, unknown>): string | null => {
  const description = operation.description;
  if (typeof description === "string" && description.trim().length > 0) {
    return description.trim();
  }

  const summary = operation.summary;
  if (typeof summary === "string" && summary.trim().length > 0) {
    return summary.trim();
  }

  return null;
};

const ensureUniqueToolIds = (
  sourceName: string,
  tools: ReadonlyArray<ExtractedTool>,
): Effect.Effect<void, OpenApiExtractionError> =>
  Effect.gen(function* () {
    const seenToolIds = new Set<string>();

    for (const tool of tools) {
      if (seenToolIds.has(tool.toolId)) {
        return yield* new OpenApiExtractionError({
          sourceName,
          stage: "extract",
          message: `Duplicate toolId detected: ${tool.toolId}`,
          details: `${tool.method.toUpperCase()} ${tool.path}`,
        });
      }

      seenToolIds.add(tool.toolId);
    }
  });

const toExtractionError = (
  sourceName: string,
  stage: OpenApiExtractionStage,
  cause: unknown,
): OpenApiExtractionError =>
  cause instanceof OpenApiExtractionError
    ? cause
    : new OpenApiExtractionError({
        sourceName,
        stage,
        message: "OpenAPI extraction failed",
        details: ParseResult.isParseError(cause)
          ? ParseResult.TreeFormatter.formatErrorSync(cause)
          : String(cause),
      });

export const extractOpenApiManifest = (
  sourceName: string,
  openApiSpec: unknown,
): Effect.Effect<ToolManifest, OpenApiExtractionError> =>
  Effect.gen(function* () {
    if (!isRecord(openApiSpec)) {
      return yield* new OpenApiExtractionError({
        sourceName,
        stage: "validate",
        message: "OpenAPI spec must be an object",
        details: null,
      });
    }

    const pathsValue = openApiSpec.paths;
    if (!isRecord(pathsValue)) {
      return {
        version: 1 as const,
        sourceHash: hashUnknown(openApiSpec),
        tools: [],
      };
    }

    const tools: Array<ExtractedTool> = [];

    for (const pathValue of Object.keys(pathsValue).sort()) {
      const pathItem = pathsValue[pathValue];
      if (!isRecord(pathItem)) {
        continue;
      }

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!isRecord(operation)) {
          continue;
        }

        tools.push({
          toolId: buildToolId(method, pathValue, operation),
          name: buildToolName(method, pathValue, operation),
          description: buildToolDescription(operation),
          method,
          path: pathValue,
          operationHash: hashUnknown({
            method,
            path: pathValue,
            operation,
          }),
        });
      }
    }

    tools.sort((left, right) => left.toolId.localeCompare(right.toolId));
    yield* ensureUniqueToolIds(sourceName, tools);

    return {
      version: 1 as const,
      sourceHash: hashUnknown(openApiSpec),
      tools,
    };
  }).pipe(Effect.mapError((cause) => toExtractionError(sourceName, "extract", cause)));

const makeToolArtifactId = (source: Source): ToolArtifact["id"] =>
  decodeToolArtifactId(`tool_artifact_${source.id}`);

const diffForReusedManifest = (manifest: ToolManifest): ToolManifestDiff => ({
  added: [],
  changed: [],
  removed: [],
  unchangedCount: manifest.tools.length,
});

const diffForReplacedManifest = (manifest: ToolManifest): ToolManifestDiff => ({
  added: manifest.tools.map((tool) => tool.toolId),
  changed: [],
  removed: [],
  unchangedCount: 0,
});

export const refreshOpenApiArtifact = (
  input: RefreshOpenApiArtifactInput,
): Effect.Effect<RefreshOpenApiArtifactResult, ToolArtifactStoreError | OpenApiExtractionError> =>
  Effect.gen(function* () {
    const now = input.now ?? Date.now;

    const manifest = yield* extractOpenApiManifest(input.source.name, input.openApiSpec);
    const existingArtifactOption = yield* input.artifactStore.getBySource(
      input.source.workspaceId,
      input.source.id,
    );

    const existingArtifact = Option.getOrUndefined(existingArtifactOption);

    if (existingArtifact && existingArtifact.sourceHash === manifest.sourceHash) {
      return {
        artifact: existingArtifact,
        manifest,
        diff: diffForReusedManifest(manifest),
        reused: true,
      };
    }

    const currentTime = now();
    const manifestJson = yield* pipe(
      encodeManifestToJson(manifest),
      Effect.mapError((cause) =>
        toExtractionError(input.source.name, "encode_manifest", cause),
      ),
    );

    const nextArtifact: ToolArtifact = {
      id: existingArtifact?.id ?? makeToolArtifactId(input.source),
      workspaceId: input.source.workspaceId,
      sourceId: input.source.id,
      sourceHash: manifest.sourceHash,
      toolCount: manifest.tools.length,
      manifestJson,
      createdAt: existingArtifact?.createdAt ?? currentTime,
      updatedAt: currentTime,
    };

    yield* input.artifactStore.upsert(nextArtifact);

    return {
      artifact: nextArtifact,
      manifest,
      diff: diffForReplacedManifest(manifest),
      reused: false,
    };
  });
