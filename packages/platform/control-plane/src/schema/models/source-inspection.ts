import { Schema } from "effect";

import { SourceSchema } from "./source";

export const SourceInspectionPipelineKindSchema = Schema.Literal("ir");

export const SourceInspectionToolSummarySchema = Schema.Struct({
  path: Schema.String,
  sourceKey: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  protocol: Schema.String,
  toolId: Schema.String,
  rawToolId: Schema.NullOr(Schema.String),
  operationId: Schema.NullOr(Schema.String),
  group: Schema.NullOr(Schema.String),
  leaf: Schema.NullOr(Schema.String),
  tags: Schema.Array(Schema.String),
  method: Schema.NullOr(Schema.String),
  pathTemplate: Schema.NullOr(Schema.String),
  inputTypePreview: Schema.optional(Schema.String),
  outputTypePreview: Schema.optional(Schema.String),
});

export const SourceInspectionFactItemSchema = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  mono: Schema.optional(Schema.Boolean),
});

export const SourceInspectionFactsSectionSchema = Schema.Struct({
  kind: Schema.Literal("facts"),
  title: Schema.String,
  items: Schema.Array(SourceInspectionFactItemSchema),
});

export const SourceInspectionMarkdownSectionSchema = Schema.Struct({
  kind: Schema.Literal("markdown"),
  title: Schema.String,
  body: Schema.String,
});

export const SourceInspectionCodeSectionSchema = Schema.Struct({
  kind: Schema.Literal("code"),
  title: Schema.String,
  language: Schema.String,
  body: Schema.String,
});

export const SourceInspectionSectionSchema = Schema.Union(
  SourceInspectionFactsSectionSchema,
  SourceInspectionMarkdownSectionSchema,
  SourceInspectionCodeSectionSchema,
);

export const SourceInspectionToolListItemSchema = Schema.Struct({
  path: Schema.String,
  method: Schema.NullOr(Schema.String),
});

export const SourceInspectionSchema = Schema.Struct({
  source: SourceSchema,
  namespace: Schema.String,
  pipelineKind: SourceInspectionPipelineKindSchema,
  toolCount: Schema.Number,
  tools: Schema.Array(SourceInspectionToolListItemSchema),
});

export const SourceInspectionToolDetailSchema = Schema.Struct({
  summary: SourceInspectionToolSummarySchema,
  sections: Schema.Array(SourceInspectionSectionSchema),
});

export const SourceInspectionDiscoverPayloadSchema = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});

export const SourceInspectionDiscoverResultItemSchema = Schema.Struct({
  path: Schema.String,
  score: Schema.Number,
  description: Schema.optional(Schema.String),
  inputTypePreview: Schema.optional(Schema.String),
  outputTypePreview: Schema.optional(Schema.String),
  reasons: Schema.Array(Schema.String),
});

export const SourceInspectionDiscoverResultSchema = Schema.Struct({
  query: Schema.String,
  queryTokens: Schema.Array(Schema.String),
  bestPath: Schema.NullOr(Schema.String),
  total: Schema.Number,
  results: Schema.Array(SourceInspectionDiscoverResultItemSchema),
});

export type SourceInspectionPipelineKind =
  typeof SourceInspectionPipelineKindSchema.Type;
export type SourceInspectionToolSummary =
  typeof SourceInspectionToolSummarySchema.Type;
export type SourceInspectionFactItem =
  typeof SourceInspectionFactItemSchema.Type;
export type SourceInspectionFactsSection =
  typeof SourceInspectionFactsSectionSchema.Type;
export type SourceInspectionMarkdownSection =
  typeof SourceInspectionMarkdownSectionSchema.Type;
export type SourceInspectionCodeSection =
  typeof SourceInspectionCodeSectionSchema.Type;
export type SourceInspectionSection =
  typeof SourceInspectionSectionSchema.Type;
export type SourceInspectionToolListItem =
  typeof SourceInspectionToolListItemSchema.Type;
export type SourceInspection = typeof SourceInspectionSchema.Type;
export type SourceInspectionToolDetail =
  typeof SourceInspectionToolDetailSchema.Type;
export type SourceInspectionDiscoverPayload =
  typeof SourceInspectionDiscoverPayloadSchema.Type;
export type SourceInspectionDiscoverResultItem =
  typeof SourceInspectionDiscoverResultItemSchema.Type;
export type SourceInspectionDiscoverResult =
  typeof SourceInspectionDiscoverResultSchema.Type;
