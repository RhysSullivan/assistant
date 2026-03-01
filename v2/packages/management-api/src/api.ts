import { HttpApi, OpenApi } from "@effect/platform";

import { ApprovalsApi } from "./approvals/api";
import { SourcesApi } from "./sources/api";

export {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "./errors";

export {
  RemoveSourceResultSchema,
  UpsertSourcePayloadSchema,
  type RemoveSourceResult,
  type UpsertSourcePayload,
} from "./sources/api";

export {
  ResolveApprovalPayloadSchema,
  ResolveApprovalStatusSchema,
  type ResolveApprovalPayload,
} from "./approvals/api";

export class ControlPlaneApi extends HttpApi.make("controlPlane")
  .add(SourcesApi)
  .add(ApprovalsApi)
  .annotateContext(
    OpenApi.annotations({
      title: "Executor v2 Management API",
      description: "Backend-agnostic management API",
    }),
  ) {}

export const controlPlaneOpenApiSpec = OpenApi.fromApi(ControlPlaneApi);
