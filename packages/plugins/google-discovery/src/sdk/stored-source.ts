import { Schema } from "effect";

import { GoogleDiscoveryAnnotationPolicy, GoogleDiscoveryStoredSourceData } from "./types";

// ---------------------------------------------------------------------------
// Stored source — the shape persisted by the binding store and exposed
// via the getSource HTTP endpoint.
// ---------------------------------------------------------------------------

export class GoogleDiscoveryStoredSourceSchema extends Schema.Class<GoogleDiscoveryStoredSourceSchema>(
  "GoogleDiscoveryStoredSource",
)({
  namespace: Schema.String,
  name: Schema.String,
  config: GoogleDiscoveryStoredSourceData,
  annotationPolicy: Schema.optional(GoogleDiscoveryAnnotationPolicy),
}) {}

export type GoogleDiscoveryStoredSourceSchemaType = typeof GoogleDiscoveryStoredSourceSchema.Type;
