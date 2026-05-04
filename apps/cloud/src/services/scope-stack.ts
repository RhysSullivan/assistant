// ---------------------------------------------------------------------------
// Scope stack builders
// ---------------------------------------------------------------------------
//
// Two flavors mirror the URL contexts the plan calls out:
//
//   Global  (`/:org`):
//     [user_org_<userId>_<orgId>,  org_<orgId>]
//
//   Workspace (`/:org/:workspace`):
//     [user_workspace_<userId>_<workspaceId>,
//      workspace_<workspaceId>,
//      user_org_<userId>_<orgId>,
//      org_<orgId>]
//
// Innermost first — the executor walks the stack so user-level wins over
// org-level on read, and writes target whichever scope the caller names.
// `activeWriteScopeId` is the default scope a source-definition write should
// target unless the caller picks something else.

import { Scope } from "@executor-js/sdk";

import {
  orgScopeId,
  userOrgScopeId,
  userWorkspaceScopeId,
  workspaceScopeId,
} from "./ids";

export type GlobalContext = {
  readonly userId: string;
  readonly organizationId: string;
  readonly organizationName: string;
};

export type WorkspaceContext = GlobalContext & {
  readonly workspaceId: string;
  readonly workspaceName: string;
};

const now = () => new Date();

const orgScope = (ctx: GlobalContext): Scope =>
  new Scope({
    id: orgScopeId(ctx.organizationId),
    name: `${ctx.organizationName} Global`,
    createdAt: now(),
  });

const userOrgScope = (ctx: GlobalContext): Scope =>
  new Scope({
    id: userOrgScopeId(ctx.userId, ctx.organizationId),
    name: `Me / ${ctx.organizationName}`,
    createdAt: now(),
  });

const workspaceScope = (ctx: WorkspaceContext): Scope =>
  new Scope({
    id: workspaceScopeId(ctx.workspaceId),
    name: ctx.workspaceName,
    createdAt: now(),
  });

const userWorkspaceScope = (ctx: WorkspaceContext): Scope =>
  new Scope({
    id: userWorkspaceScopeId(ctx.userId, ctx.workspaceId),
    name: `Me / ${ctx.workspaceName}`,
    createdAt: now(),
  });

export const buildGlobalScopeStack = (
  ctx: GlobalContext,
): readonly [Scope, Scope] => [userOrgScope(ctx), orgScope(ctx)] as const;

export const buildWorkspaceScopeStack = (
  ctx: WorkspaceContext,
): readonly [Scope, Scope, Scope, Scope] => [
  userWorkspaceScope(ctx),
  workspaceScope(ctx),
  userOrgScope(ctx),
  orgScope(ctx),
] as const;

/**
 * Default scope for source-definition writes in the active context. `org` for
 * global, `workspace` for workspace contexts. Callers MUST still pass an
 * explicit target on the write — this is purely a UI default.
 */
export const activeWriteScopeId = (
  ctx: GlobalContext | WorkspaceContext,
) => {
  if ("workspaceId" in ctx) {
    return workspaceScopeId(ctx.workspaceId);
  }
  return orgScopeId(ctx.organizationId);
};
