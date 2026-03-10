import type { OpenAPISpec } from "@effect/platform/OpenApi";

import { Schema } from "effect";

export type OpenApiJsonPrimitive = string | number | boolean | null;

export type OpenApiJsonValue =
  | OpenApiJsonPrimitive
  | OpenApiJsonObject
  | Array<OpenApiJsonValue>;

export type OpenApiJsonObject = {
  [key: string]: OpenApiJsonValue;
};

export type OpenApiSpecInput = string | OpenAPISpec | OpenApiJsonObject;

export const OPEN_API_HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;

export const OPEN_API_PARAMETER_LOCATIONS = [
  "path",
  "query",
  "header",
  "cookie",
] as const;

export const OpenApiHttpMethodSchema = Schema.Literal(...OPEN_API_HTTP_METHODS);

export const OpenApiParameterLocationSchema = Schema.Literal(
  ...OPEN_API_PARAMETER_LOCATIONS,
);

export const OpenApiToolParameterSchema = Schema.Struct({
  name: Schema.String,
  location: OpenApiParameterLocationSchema,
  required: Schema.Boolean,
});

export const OpenApiToolRequestBodySchema = Schema.Struct({
  required: Schema.Boolean,
  contentTypes: Schema.Array(Schema.String),
});

export const OpenApiInvocationPayloadSchema = Schema.Struct({
  method: OpenApiHttpMethodSchema,
  pathTemplate: Schema.String,
  parameters: Schema.Array(OpenApiToolParameterSchema),
  requestBody: Schema.NullOr(OpenApiToolRequestBodySchema),
});

export const DiscoveryTypingPayloadSchema = Schema.Struct({
  inputSchemaJson: Schema.optional(Schema.String),
  outputSchemaJson: Schema.optional(Schema.String),
  refHintKeys: Schema.optional(Schema.Array(Schema.String)),
});

export const OpenApiRefHintValueSchema = Schema.Union(
  Schema.String,
  Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
);

export const OpenApiRefHintTableSchema = Schema.Record({
  key: Schema.String,
  value: OpenApiRefHintValueSchema,
});

export const OpenApiExampleSchema = Schema.Struct({
  valueJson: Schema.String,
  mediaType: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
});

export const OpenApiParameterDocumentationSchema = Schema.Struct({
  name: Schema.String,
  location: OpenApiParameterLocationSchema,
  required: Schema.Boolean,
  description: Schema.optional(Schema.String),
  examples: Schema.optional(Schema.Array(OpenApiExampleSchema)),
});

export const OpenApiRequestBodyDocumentationSchema = Schema.Struct({
  description: Schema.optional(Schema.String),
  examples: Schema.optional(Schema.Array(OpenApiExampleSchema)),
});

export const OpenApiResponseDocumentationSchema = Schema.Struct({
  statusCode: Schema.String,
  description: Schema.optional(Schema.String),
  contentTypes: Schema.Array(Schema.String),
  examples: Schema.optional(Schema.Array(OpenApiExampleSchema)),
});

export const OpenApiToolDocumentationSchema = Schema.Struct({
  summary: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean),
  parameters: Schema.Array(OpenApiParameterDocumentationSchema),
  requestBody: Schema.optional(OpenApiRequestBodyDocumentationSchema),
  response: Schema.optional(OpenApiResponseDocumentationSchema),
});

export const OpenApiToolProviderDataSchema = Schema.Struct({
  kind: Schema.Literal("openapi"),
  toolId: Schema.String,
  rawToolId: Schema.String,
  operationId: Schema.optional(Schema.String),
  group: Schema.String,
  leaf: Schema.String,
  tags: Schema.Array(Schema.String),
  versionSegment: Schema.optional(Schema.String),
  method: OpenApiHttpMethodSchema,
  path: Schema.String,
  operationHash: Schema.String,
  invocation: OpenApiInvocationPayloadSchema,
  documentation: Schema.optional(OpenApiToolDocumentationSchema),
});

export const OpenApiExtractedToolSchema = Schema.Struct({
  toolId: Schema.String,
  operationId: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  method: OpenApiHttpMethodSchema,
  path: Schema.String,
  invocation: OpenApiInvocationPayloadSchema,
  operationHash: Schema.String,
  typing: Schema.optional(DiscoveryTypingPayloadSchema),
  documentation: Schema.optional(OpenApiToolDocumentationSchema),
});

export const OpenApiToolManifestSchema = Schema.Struct({
  version: Schema.Literal(2),
  sourceHash: Schema.String,
  tools: Schema.Array(OpenApiExtractedToolSchema),
  refHintTable: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
});

export type OpenApiHttpMethod = typeof OpenApiHttpMethodSchema.Type;
export type OpenApiParameterLocation = typeof OpenApiParameterLocationSchema.Type;
export type OpenApiToolParameter = typeof OpenApiToolParameterSchema.Type;
export type OpenApiToolRequestBody = typeof OpenApiToolRequestBodySchema.Type;
export type OpenApiInvocationPayload = typeof OpenApiInvocationPayloadSchema.Type;
export type DiscoveryTypingPayload = typeof DiscoveryTypingPayloadSchema.Type;
export type OpenApiRefHintValue = typeof OpenApiRefHintValueSchema.Type;
export type OpenApiRefHintTable = typeof OpenApiRefHintTableSchema.Type;
export type OpenApiExample = typeof OpenApiExampleSchema.Type;
export type OpenApiParameterDocumentation = typeof OpenApiParameterDocumentationSchema.Type;
export type OpenApiRequestBodyDocumentation = typeof OpenApiRequestBodyDocumentationSchema.Type;
export type OpenApiResponseDocumentation = typeof OpenApiResponseDocumentationSchema.Type;
export type OpenApiToolDocumentation = typeof OpenApiToolDocumentationSchema.Type;
export type OpenApiToolProviderData = typeof OpenApiToolProviderDataSchema.Type;
export type OpenApiExtractedTool = typeof OpenApiExtractedToolSchema.Type;
export type OpenApiToolManifest = typeof OpenApiToolManifestSchema.Type;
