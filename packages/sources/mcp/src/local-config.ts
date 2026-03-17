import * as Schema from "effect/Schema";

import {
  SourceTransportSchema,
  StringMapSchema,
} from "@executor/source-core";

export const McpLocalConfigBindingSchema = Schema.Struct({
  transport: Schema.optional(Schema.NullOr(SourceTransportSchema)),
  queryParams: Schema.optional(Schema.NullOr(StringMapSchema)),
  headers: Schema.optional(Schema.NullOr(StringMapSchema)),
});
