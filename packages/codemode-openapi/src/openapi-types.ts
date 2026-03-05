import { Schema } from "effect";

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

export const OpenApiExtractedToolSchema = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  method: OpenApiHttpMethodSchema,
  path: Schema.String,
  invocation: OpenApiInvocationPayloadSchema,
  operationHash: Schema.String,
  typing: Schema.optional(DiscoveryTypingPayloadSchema),
});

export const OpenApiToolManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
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
export type OpenApiExtractedTool = typeof OpenApiExtractedToolSchema.Type;
export type OpenApiToolManifest = typeof OpenApiToolManifestSchema.Type;
