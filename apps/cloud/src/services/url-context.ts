// ---------------------------------------------------------------------------
// URL context resolution — `:org` / `:org/:workspace` -> identity records
// ---------------------------------------------------------------------------
//
// The plan moves cloud's "active context" off the session cookie and onto the
// URL. These helpers translate URL handles/slugs to organization + workspace
// rows, gated by the WorkOS membership check the protected middleware
// performs separately.
//
// They do NOT build the scope stack (see `./scope-stack`) and do NOT validate
// org membership — that's the middleware's job. They DO confirm that a
// workspace lives in the org named by the handle, so a workspace slug from
// org A can't be addressed under org B's URL.

import { Effect } from "effect";

import { DbService } from "./db";
import { makeUserStore, type Organization } from "./user-store";
import { makeWorkspaceStore, type Workspace } from "./workspace-store";

export type ResolvedOrgContext = {
  readonly organization: Organization;
};

export type ResolvedWorkspaceContext = ResolvedOrgContext & {
  readonly workspace: Workspace;
};

export class OrganizationHandleNotFound extends Error {
  readonly _tag = "OrganizationHandleNotFound" as const;
  constructor(readonly handle: string) {
    super(`organization handle "${handle}" not found`);
  }
}

export class WorkspaceSlugNotFound extends Error {
  readonly _tag = "WorkspaceSlugNotFound" as const;
  constructor(readonly orgHandle: string, readonly slug: string) {
    super(`workspace "${slug}" not found in org "${orgHandle}"`);
  }
}

/** Resolve a `/:org` URL segment to its organization row. */
export const resolveOrgContext = (orgHandle: string) =>
  Effect.gen(function* () {
    const { db } = yield* DbService;
    const organization = yield* Effect.promise(() =>
      makeUserStore(db).getOrganizationByHandle(orgHandle),
    );
    if (!organization) {
      return yield* Effect.fail(new OrganizationHandleNotFound(orgHandle));
    }
    return { organization } satisfies ResolvedOrgContext;
  });

/**
 * Resolve a `/:org/:workspace` URL segment pair to its organization +
 * workspace rows. Fails if either lookup misses, or if the workspace exists
 * but belongs to a different organization than the URL says.
 */
export const resolveWorkspaceContext = (
  orgHandle: string,
  workspaceSlug: string,
) =>
  Effect.gen(function* () {
    const orgCtx = yield* resolveOrgContext(orgHandle);
    const { db } = yield* DbService;
    const workspace = yield* Effect.promise(() =>
      makeWorkspaceStore(db).getBySlug(orgCtx.organization.id, workspaceSlug),
    );
    if (!workspace) {
      return yield* Effect.fail(
        new WorkspaceSlugNotFound(orgHandle, workspaceSlug),
      );
    }
    return {
      ...orgCtx,
      workspace,
    } satisfies ResolvedWorkspaceContext;
  });
