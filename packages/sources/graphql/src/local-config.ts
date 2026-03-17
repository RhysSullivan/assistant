import * as Schema from "effect/Schema";

import { StringMapSchema } from "@executor/source-core";

export const GraphqlLocalConfigBindingSchema = Schema.Struct({
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
});
