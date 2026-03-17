import * as Schema from "effect/Schema";

import { StringMapSchema } from "@executor/source-core";

export const GoogleDiscoveryLocalConfigBindingSchema = Schema.Struct({
  service: Schema.String,
  version: Schema.String,
  discoveryUrl: Schema.optional(Schema.NullOr(Schema.String)),
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
  scopes: Schema.optional(Schema.Array(Schema.String)),
});
