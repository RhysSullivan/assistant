import * as Schema from "effect/Schema";

import {
  TrimmedNonEmptyStringSchema,
} from "../string-schemas";

export const CreateExecutionPayloadSchema = Schema.Struct({
  code: TrimmedNonEmptyStringSchema,
  interactionMode: Schema.optional(
    Schema.Literal("live", "live_form", "detach"),
  ),
});

export type CreateExecutionPayload = typeof CreateExecutionPayloadSchema.Type;

export const ResumeExecutionPayloadSchema = Schema.Struct({
  responseJson: Schema.optional(Schema.String),
  interactionMode: Schema.optional(
    Schema.Literal("live", "live_form", "detach"),
  ),
});

export type ResumeExecutionPayload = typeof ResumeExecutionPayloadSchema.Type;
