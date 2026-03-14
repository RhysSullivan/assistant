import { HttpApiBuilder } from "@effect/platform";
import * as Effect from "effect/Effect";
import {
  createPolicy,
  getPolicy,
  listPolicies,
  removePolicy,
  updatePolicy,
} from "../../runtime/policies-operations";

import { ControlPlaneApi } from "../api";
import { resolveRequestedLocalWorkspace } from "../local-context";

export const ControlPlanePoliciesLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "policies",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        resolveRequestedLocalWorkspace("policies.list", path.workspaceId).pipe(
          Effect.zipRight(
            listPolicies(path.workspaceId),
          ),
        ),
      )
      .handle("create", ({ path, payload }) =>
        resolveRequestedLocalWorkspace("policies.create", path.workspaceId).pipe(
          Effect.zipRight(
            createPolicy({ workspaceId: path.workspaceId, payload }),
          ),
        ),
      )
      .handle("get", ({ path }) =>
        resolveRequestedLocalWorkspace("policies.get", path.workspaceId).pipe(
          Effect.zipRight(
            getPolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
            }),
          ),
        ),
      )
      .handle("update", ({ path, payload }) =>
        resolveRequestedLocalWorkspace("policies.update", path.workspaceId).pipe(
          Effect.zipRight(
            updatePolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
              payload,
            }),
          ),
        ),
      )
      .handle("remove", ({ path }) =>
        resolveRequestedLocalWorkspace("policies.remove", path.workspaceId).pipe(
          Effect.zipRight(
            removePolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
            }),
          ),
        ),
      ),
);
