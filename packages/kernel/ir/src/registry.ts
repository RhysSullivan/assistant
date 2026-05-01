import { Schema } from "effect";
import type { JsonSchema } from "effect/JsonSchema";

export class ToolRegistration extends Schema.Class<ToolRegistration>("ToolRegistration")({
  path: Schema.String,
  description: Schema.optional(Schema.String),
  sourceId: Schema.String,
  input: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}) {}

export class SerializedCatalog extends Schema.Class<SerializedCatalog>("SerializedCatalog")({
  version: Schema.Literal("v4.1"),
  types: Schema.Record(Schema.String, Schema.Unknown),
  tools: Schema.Array(ToolRegistration),
}) {}

export interface LiveToolRegistration {
  readonly path: string;
  readonly description?: string;
  readonly sourceId: string;
  readonly input?: Schema.Top;
  readonly output?: Schema.Top;
  readonly error?: Schema.Top;
}

export interface LiveCatalog {
  readonly version: "v4.1";
  readonly types: Record<string, JsonSchema>;
  readonly tools: readonly LiveToolRegistration[];
}
