import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import {
  ExecutionIdSchema,
  ExecutionSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Schema from "effect/Schema";

import {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "../errors";

export const CreateExecutionPayloadSchema = Schema.Struct({
  code: Schema.String,
});

export type CreateExecutionPayload = typeof CreateExecutionPayloadSchema.Type;

export const ResumeExecutionPayloadSchema = Schema.Struct({
  responseJson: Schema.optional(Schema.String),
});

export type ResumeExecutionPayload = typeof ResumeExecutionPayloadSchema.Type;

const workspaceIdParam = HttpApiSchema.param("workspaceId", WorkspaceIdSchema);
const executionIdParam = HttpApiSchema.param("executionId", ExecutionIdSchema);

export class ExecutionsApi extends HttpApiGroup.make("executions")
  .add(
    HttpApiEndpoint.post("create")`/workspaces/${workspaceIdParam}/executions`
      .setPayload(CreateExecutionPayloadSchema)
      .addSuccess(ExecutionSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get("get")`/workspaces/${workspaceIdParam}/executions/${executionIdParam}`
      .addSuccess(ExecutionSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.post("resume")`/workspaces/${workspaceIdParam}/executions/${executionIdParam}/resume`
      .setPayload(ResumeExecutionPayloadSchema)
      .addSuccess(ExecutionSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .prefix("/v1") {}
