import * as Schema from "effect/Schema";

import { StringMapSchema } from "@executor/source-core";

export const OpenApiLocalConfigBindingSchema = Schema.Struct({
  specUrl: Schema.String,
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
});
