import { createHash } from "node:crypto";

import {
  ToolArtifactStoreError,
  type ToolArtifactStore,
} from "@executor-v2/persistence-ports";
import {
  OPEN_API_HTTP_METHODS,
  OPEN_API_PARAMETER_LOCATIONS,
  OpenApiExtractedToolSchema,
  OpenApiInvocationPayloadSchema,
  OpenApiToolManifestSchema,
  OpenApiToolParameterSchema,
  OpenApiToolRequestBodySchema,
  ToolArtifactIdSchema,
  type OpenApiExtractedTool,
  type OpenApiHttpMethod,
  type OpenApiInvocationPayload,
  type OpenApiToolManifest,
  type OpenApiToolParameter,
  type OpenApiToolRequestBody,
  type Source,
  type ToolArtifact,
} from "@executor-v2/schema";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";

const HTTP_METHODS = OPEN_API_HTTP_METHODS;

type HttpMethod = OpenApiHttpMethod;

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

const ExtractedToolParameterSchema = OpenApiToolParameterSchema;
const ExtractedToolRequestBodySchema = OpenApiToolRequestBodySchema;
const ExtractedToolInvocationSchema = OpenApiInvocationPayloadSchema;
const ExtractedToolSchema = OpenApiExtractedToolSchema;
const ToolManifestSchema = OpenApiToolManifestSchema;

type ExtractedToolParameter = OpenApiToolParameter;
type ExtractedToolRequestBody = OpenApiToolRequestBody;
type ExtractedToolInvocation = OpenApiInvocationPayload;
type ExtractedTool = OpenApiExtractedTool;
type ToolManifest = OpenApiToolManifest;

const ToolManifestFromJsonSchema = Schema.parseJson(ToolManifestSchema);
const encodeManifestToJson = Schema.encode(ToolManifestFromJsonSchema);
const decodeToolArtifactId = Schema.decodeUnknownSync(ToolArtifactIdSchema);

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

type RefreshOpenApiArtifactInput = {
  source: Source;
  openApiSpec: unknown;
  artifactStore: ToolArtifactStore;
  now?: () => number;
};

const UnknownRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

type UnknownRecord = typeof UnknownRecordSchema.Type;

const isUnknownRecord = Schema.is(UnknownRecordSchema);

const OpenApiParameterInputSchema = Schema.Struct({
  name: Schema.String,
  in: Schema.Literal(...OPEN_API_PARAMETER_LOCATIONS),
  required: Schema.optional(Schema.Boolean),
});

type OpenApiParameterInput = typeof OpenApiParameterInputSchema.Type;

const isOpenApiParameterInput = Schema.is(OpenApiParameterInputSchema);

const OpenApiRequestBodyInputSchema = Schema.Struct({
  required: Schema.optional(Schema.Boolean),
  content: Schema.optional(UnknownRecordSchema),
});

type OpenApiRequestBodyInput = typeof OpenApiRequestBodyInputSchema.Type;

const isOpenApiRequestBodyInput = Schema.is(OpenApiRequestBodyInputSchema);

const toExtractedToolParameter = (
  value: unknown,
): ExtractedToolParameter | null => {
  if (!isOpenApiParameterInput(value)) {
    return null;
  }

  const parameter: OpenApiParameterInput = value;
  const name = parameter.name.trim();

  if (name.length === 0) {
    return null;
  }

  return {
    name,
    location: parameter.in,
    required: parameter.in === "path" || parameter.required === true,
  };
};

const mergeParameters = (
  pathItem: UnknownRecord,
  operation: UnknownRecord,
): Array<ExtractedToolParameter> => {
  const byKey = new Map<string, ExtractedToolParameter>();

  const addParameters = (candidate: unknown) => {
    if (!Array.isArray(candidate)) {
      return;
    }

    for (const item of candidate) {
      const parameter = toExtractedToolParameter(item);
      if (!parameter) {
        continue;
      }
      byKey.set(`${parameter.location}:${parameter.name}`, parameter);
    }
  };

  addParameters(pathItem.parameters);
  addParameters(operation.parameters);

  return Array.from(byKey.values()).sort((left, right) => {
    if (left.location === right.location) {
      return left.name.localeCompare(right.name);
    }

    return left.location.localeCompare(right.location);
  });
};

const extractRequestBody = (
  operation: UnknownRecord,
): ExtractedToolRequestBody | null => {
  const requestBody = operation.requestBody;

  if (!isOpenApiRequestBodyInput(requestBody)) {
    return null;
  }

  const openApiRequestBody: OpenApiRequestBodyInput = requestBody;
  const contentTypes = openApiRequestBody.content
    ? Object.keys(openApiRequestBody.content).sort()
    : [];

  return {
    required: openApiRequestBody.required === true,
    contentTypes,
  };
};

const buildInvocationMetadata = (
  method: HttpMethod,
  pathValue: string,
  pathItem: UnknownRecord,
  operation: UnknownRecord,
): ExtractedToolInvocation => ({
  method,
  pathTemplate: pathValue,
  parameters: mergeParameters(pathItem, operation),
  requestBody: extractRequestBody(operation),
});

const toStableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }

  if (isUnknownRecord(value)) {
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
    if (!isUnknownRecord(openApiSpec)) {
      return yield* new OpenApiExtractionError({
        sourceName,
        stage: "validate",
        message: "OpenAPI spec must be an object",
        details: null,
      });
    }

    const specRecord: UnknownRecord = openApiSpec;
    const pathsValue = specRecord.paths;
    if (!isUnknownRecord(pathsValue)) {
      return {
        version: 1 as const,
        sourceHash: hashUnknown(specRecord),
        tools: [],
      };
    }

    const tools: Array<ExtractedTool> = [];

    for (const pathValue of Object.keys(pathsValue).sort()) {
      const pathItem = pathsValue[pathValue];
      if (!isUnknownRecord(pathItem)) {
        continue;
      }

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!isUnknownRecord(operation)) {
          continue;
        }

        const invocation = buildInvocationMetadata(
          method,
          pathValue,
          pathItem,
          operation,
        );

        tools.push({
          toolId: buildToolId(method, pathValue, operation),
          name: buildToolName(method, pathValue, operation),
          description: buildToolDescription(operation),
          method,
          path: pathValue,
          invocation,
          operationHash: hashUnknown({
            method,
            path: pathValue,
            operation,
            invocation,
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
