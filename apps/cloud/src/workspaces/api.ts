// ---------------------------------------------------------------------------
// Workspaces HTTP API — schemas + endpoint definitions
// ---------------------------------------------------------------------------
//
// Workspace context is org-scoped; the existing OrgAuth middleware (org
// membership check on the active session) covers authorization. v1 surface:
// create, list, get-by-slug. Slug is auto-generated from `name`; the client
// can override by passing `slug` explicitly.

import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Schema } from "effect";

const Workspace = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});

export class WorkspaceNotFound extends Schema.TaggedErrorClass<WorkspaceNotFound>()(
  "WorkspaceNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class InvalidWorkspaceName extends Schema.TaggedErrorClass<InvalidWorkspaceName>()(
  "InvalidWorkspaceName",
  { reason: Schema.String },
  { httpApiStatus: 400 },
) {}

const CreateWorkspaceBody = Schema.Struct({
  name: Schema.String,
  slug: Schema.optional(Schema.String),
});

const SlugParam = { slug: Schema.String };

const ListResponse = Schema.Struct({
  workspaces: Schema.Array(Workspace),
});

export class WorkspacesApi extends HttpApiGroup.make("workspaces")
  .add(
    HttpApiEndpoint.get("listWorkspaces", "/workspaces", {
      success: ListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createWorkspace", "/workspaces", {
      payload: CreateWorkspaceBody,
      success: Workspace,
      error: InvalidWorkspaceName,
    }),
  )
  .add(
    HttpApiEndpoint.get("getWorkspace", "/workspaces/:slug", {
      params: SlugParam,
      success: Workspace,
      error: WorkspaceNotFound,
    }),
  ) {}

export { Workspace };
