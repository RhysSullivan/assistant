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
  style: Schema.optional(Schema.String),
  explode: Schema.optional(Schema.Boolean),
  allowReserved: Schema.optional(Schema.Boolean),
  content: Schema.optional(Schema.Array(Schema.suspend(() => OpenApiMediaContentSchema))),
});

export const OpenApiMediaContentSchema = Schema.Struct({
  mediaType: Schema.String,
  schema: Schema.optional(Schema.Unknown),
  examples: Schema.optional(Schema.Array(Schema.suspend(() => OpenApiExampleSchema))),
});

export const OpenApiHeaderSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
  deprecated: Schema.optional(Schema.Boolean),
  schema: Schema.optional(Schema.Unknown),
  content: Schema.optional(Schema.Array(OpenApiMediaContentSchema)),
  style: Schema.optional(Schema.String),
  explode: Schema.optional(Schema.Boolean),
  examples: Schema.optional(Schema.Array(Schema.suspend(() => OpenApiExampleSchema))),
});

export const OpenApiToolRequestBodySchema = Schema.Struct({
  required: Schema.Boolean,
  contentTypes: Schema.Array(Schema.String),
  contents: Schema.optional(Schema.Array(OpenApiMediaContentSchema)),
});

export const OpenApiServerSchema = Schema.Struct({
  url: Schema.String,
  description: Schema.optional(Schema.String),
  variables: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
});

export const OpenApiInvocationPayloadSchema = Schema.Struct({
  method: OpenApiHttpMethodSchema,
  pathTemplate: Schema.String,
  parameters: Schema.Array(OpenApiToolParameterSchema),
  requestBody: Schema.NullOr(OpenApiToolRequestBodySchema),
});

export const DiscoveryTypingPayloadSchema = Schema.Struct({
  inputSchema: Schema.optional(Schema.Unknown),
  outputSchema: Schema.optional(Schema.Unknown),
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

export const OpenApiResponseVariantSchema = Schema.Struct({
  statusCode: Schema.String,
  description: Schema.optional(Schema.String),
  contentTypes: Schema.Array(Schema.String),
  schema: Schema.optional(Schema.Unknown),
  examples: Schema.optional(Schema.Array(OpenApiExampleSchema)),
  contents: Schema.optional(Schema.Array(OpenApiMediaContentSchema)),
  headers: Schema.optional(Schema.Array(OpenApiHeaderSchema)),
});

export const OpenApiToolDocumentationSchema = Schema.Struct({
  summary: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean),
  parameters: Schema.Array(OpenApiParameterDocumentationSchema),
  requestBody: Schema.optional(OpenApiRequestBodyDocumentationSchema),
  response: Schema.optional(OpenApiResponseDocumentationSchema),
});

export type OpenApiSecurityRequirement =
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "scheme";
      readonly schemeName: string;
      readonly scopes?: readonly string[];
    }
  | {
      readonly kind: "allOf";
      readonly items: readonly OpenApiSecurityRequirement[];
    }
  | {
      readonly kind: "anyOf";
      readonly items: readonly OpenApiSecurityRequirement[];
    };

export const OpenApiSecurityRequirementSchema = Schema.suspend(() =>
  Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("none"),
    }),
    Schema.Struct({
      kind: Schema.Literal("scheme"),
      schemeName: Schema.String,
      scopes: Schema.optional(Schema.Array(Schema.String)),
    }),
    Schema.Struct({
      kind: Schema.Literal("allOf"),
      items: Schema.Array(OpenApiSecurityRequirementSchema),
    }),
    Schema.Struct({
      kind: Schema.Literal("anyOf"),
      items: Schema.Array(OpenApiSecurityRequirementSchema),
    }),
  )
) as Schema.Schema<OpenApiSecurityRequirement, OpenApiSecurityRequirement, never>;

export const OpenApiSecuritySchemeTypeSchema = Schema.Literal(
  "apiKey",
  "http",
  "oauth2",
  "openIdConnect",
);

export const OpenApiOAuthFlowSchema = Schema.Struct({
  authorizationUrl: Schema.optional(Schema.String),
  tokenUrl: Schema.optional(Schema.String),
  refreshUrl: Schema.optional(Schema.String),
  scopes: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
});

export const OpenApiSecuritySchemeSchema = Schema.Struct({
  schemeName: Schema.String,
  schemeType: OpenApiSecuritySchemeTypeSchema,
  description: Schema.optional(Schema.String),
  placementIn: Schema.optional(Schema.Literal("header", "query", "cookie")),
  placementName: Schema.optional(Schema.String),
  scheme: Schema.optional(Schema.String),
  bearerFormat: Schema.optional(Schema.String),
  openIdConnectUrl: Schema.optional(Schema.String),
  flows: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: OpenApiOAuthFlowSchema,
    }),
  ),
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
  responses: Schema.optional(Schema.Array(OpenApiResponseVariantSchema)),
  authRequirement: Schema.optional(OpenApiSecurityRequirementSchema),
  securitySchemes: Schema.optional(Schema.Array(OpenApiSecuritySchemeSchema)),
  documentServers: Schema.optional(Schema.Array(OpenApiServerSchema)),
  servers: Schema.optional(Schema.Array(OpenApiServerSchema)),
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
  responses: Schema.optional(Schema.Array(OpenApiResponseVariantSchema)),
  authRequirement: Schema.optional(OpenApiSecurityRequirementSchema),
  securitySchemes: Schema.optional(Schema.Array(OpenApiSecuritySchemeSchema)),
  documentServers: Schema.optional(Schema.Array(OpenApiServerSchema)),
  servers: Schema.optional(Schema.Array(OpenApiServerSchema)),
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
export type OpenApiMediaContent = typeof OpenApiMediaContentSchema.Type;
export type OpenApiHeader = typeof OpenApiHeaderSchema.Type;
export type OpenApiToolRequestBody = typeof OpenApiToolRequestBodySchema.Type;
export type OpenApiServer = typeof OpenApiServerSchema.Type;
export type OpenApiInvocationPayload = typeof OpenApiInvocationPayloadSchema.Type;
export type DiscoveryTypingPayload = typeof DiscoveryTypingPayloadSchema.Type;
export type OpenApiRefHintValue = typeof OpenApiRefHintValueSchema.Type;
export type OpenApiRefHintTable = typeof OpenApiRefHintTableSchema.Type;
export type OpenApiExample = typeof OpenApiExampleSchema.Type;
export type OpenApiParameterDocumentation = typeof OpenApiParameterDocumentationSchema.Type;
export type OpenApiRequestBodyDocumentation = typeof OpenApiRequestBodyDocumentationSchema.Type;
export type OpenApiResponseDocumentation = typeof OpenApiResponseDocumentationSchema.Type;
export type OpenApiResponseVariant = typeof OpenApiResponseVariantSchema.Type;
export type OpenApiToolDocumentation = typeof OpenApiToolDocumentationSchema.Type;
export type OpenApiOAuthFlow = typeof OpenApiOAuthFlowSchema.Type;
export type OpenApiSecuritySchemeType = typeof OpenApiSecuritySchemeTypeSchema.Type;
export type OpenApiSecurityScheme = typeof OpenApiSecuritySchemeSchema.Type;
export type OpenApiToolProviderData = typeof OpenApiToolProviderDataSchema.Type;
export type OpenApiExtractedTool = typeof OpenApiExtractedToolSchema.Type;
export type OpenApiToolManifest = typeof OpenApiToolManifestSchema.Type;
