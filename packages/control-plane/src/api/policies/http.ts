import { HttpApiBuilder } from "@effect/platform";
import type { WorkspaceId } from "#schema";

import { requirePermission, withPolicy } from "#domain";
import {
  createPolicy,
  getPolicy,
  listPolicies,
  removePolicy,
  updatePolicy,
} from "../../runtime/policies-operations";

import { ControlPlaneApi } from "../api";
import { withWorkspaceRequestActor } from "../http-auth";

const requireReadPolicies = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "policies:read",
    workspaceId,
  });

const requireWritePolicies = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "policies:write",
    workspaceId,
  });

export const ControlPlanePoliciesLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "policies",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        withWorkspaceRequestActor("policies.list", path.workspaceId, () =>
          withPolicy(requireReadPolicies(path.workspaceId))(
            listPolicies(path.workspaceId),
          ),
        ),
      )
      .handle("create", ({ path, payload }) =>
        withWorkspaceRequestActor("policies.create", path.workspaceId, () =>
          withPolicy(requireWritePolicies(path.workspaceId))(
            createPolicy({ workspaceId: path.workspaceId, payload }),
          ),
        ),
      )
      .handle("get", ({ path }) =>
        withWorkspaceRequestActor("policies.get", path.workspaceId, () =>
          withPolicy(requireReadPolicies(path.workspaceId))(
            getPolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
            }),
          ),
        ),
      )
      .handle("update", ({ path, payload }) =>
        withWorkspaceRequestActor("policies.update", path.workspaceId, () =>
          withPolicy(requireWritePolicies(path.workspaceId))(
            updatePolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
              payload,
            }),
          ),
        ),
      )
      .handle("remove", ({ path }) =>
        withWorkspaceRequestActor("policies.remove", path.workspaceId, () =>
          withPolicy(requireWritePolicies(path.workspaceId))(
            removePolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
            }),
          ),
        ),
      ),
);
