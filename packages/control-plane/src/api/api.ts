import { HttpApi, OpenApi } from "@effect/platform";

import { ExecutionsApi } from "./executions/api";
import { MembershipsApi } from "./memberships/api";
import { OrganizationsApi } from "./organizations/api";
import { PoliciesApi } from "./policies/api";
import { SourcesApi } from "./sources/api";
import { WorkspacesApi } from "./workspaces/api";

export {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "./errors";

export {
  CreateExecutionPayloadSchema,
  ResumeExecutionPayloadSchema,
  type CreateExecutionPayload,
  type ResumeExecutionPayload,
} from "./executions/api";

export {
  CreateOrganizationPayloadSchema,
  UpdateOrganizationPayloadSchema,
  type CreateOrganizationPayload,
  type UpdateOrganizationPayload,
} from "./organizations/api";

export {
  CreateMembershipPayloadSchema,
  UpdateMembershipPayloadSchema,
  type CreateMembershipPayload,
  type UpdateMembershipPayload,
} from "./memberships/api";

export {
  CreateWorkspacePayloadSchema,
  UpdateWorkspacePayloadSchema,
  type CreateWorkspacePayload,
  type UpdateWorkspacePayload,
} from "./workspaces/api";

export {
  CreateSourcePayloadSchema,
  UpdateSourcePayloadSchema,
  type CreateSourcePayload,
  type UpdateSourcePayload,
} from "./sources/api";

export {
  CreatePolicyPayloadSchema,
  UpdatePolicyPayloadSchema,
  type CreatePolicyPayload,
  type UpdatePolicyPayload,
} from "./policies/api";

export class ControlPlaneApi extends HttpApi.make("controlPlane")
  .add(OrganizationsApi)
  .add(MembershipsApi)
  .add(WorkspacesApi)
  .add(SourcesApi)
  .add(PoliciesApi)
  .add(ExecutionsApi)
  .annotateContext(
    OpenApi.annotations({
      title: "Executor v3 Control Plane API",
      description: "CRUD control plane for organizations, workspaces, sources, and policies",
    }),
  ) {}

export const controlPlaneOpenApiSpec = OpenApi.fromApi(ControlPlaneApi);
