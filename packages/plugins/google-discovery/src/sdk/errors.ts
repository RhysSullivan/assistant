import { Schema } from "effect";

export class GoogleDiscoveryParseError extends Schema.TaggedError<GoogleDiscoveryParseError>()(
  "GoogleDiscoveryParseError",
  {
    message: Schema.String,
    error: Schema.Defect,
  },
) {}

export class GoogleDiscoveryInvocationError extends Schema.TaggedError<GoogleDiscoveryInvocationError>()(
  "GoogleDiscoveryInvocationError",
  {
    message: Schema.String,
    statusCode: Schema.optionalWith(Schema.Number, { as: "Option" }),
    error: Schema.Defect,
  },
) {}

export class GoogleDiscoveryOAuthError extends Schema.TaggedError<GoogleDiscoveryOAuthError>()(
  "GoogleDiscoveryOAuthError",
  {
    message: Schema.String,
  },
) {}

export class GoogleDiscoverySourceError extends Schema.TaggedError<GoogleDiscoverySourceError>()(
  "GoogleDiscoverySourceError",
  {
    message: Schema.String,
  },
) {}
