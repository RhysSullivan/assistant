import { Schema } from "effect";

export class GraphqlIntrospectionError extends Schema.TaggedError<GraphqlIntrospectionError>()(
  "GraphqlIntrospectionError",
  {
    message: Schema.String,
    error: Schema.Defect,
  },
) {}

export class GraphqlExtractionError extends Schema.TaggedError<GraphqlExtractionError>()(
  "GraphqlExtractionError",
  {
    message: Schema.String,
  },
) {}

export class GraphqlInvocationError extends Schema.TaggedError<GraphqlInvocationError>()(
  "GraphqlInvocationError",
  {
    message: Schema.String,
    statusCode: Schema.optionalWith(Schema.Number, { as: "Option" }),
    error: Schema.Defect,
  },
) {}
