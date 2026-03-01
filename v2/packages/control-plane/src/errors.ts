import { HttpApiSchema } from "@effect/platform";
import * as Schema from "effect/Schema";

export class ControlPlaneBadRequestError extends Schema.TaggedError<ControlPlaneBadRequestError>()(
  "ControlPlaneBadRequestError",
  {
    operation: Schema.String,
    message: Schema.String,
    details: Schema.String,
  },
  HttpApiSchema.annotations({ status: 400 }),
) {}

export class ControlPlaneStorageError extends Schema.TaggedError<ControlPlaneStorageError>()(
  "ControlPlaneStorageError",
  {
    operation: Schema.String,
    message: Schema.String,
    details: Schema.String,
  },
  HttpApiSchema.annotations({ status: 500 }),
) {}
