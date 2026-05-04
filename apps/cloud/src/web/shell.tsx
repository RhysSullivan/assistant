import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useSourcesWithPending } from "@executor-js/react/api/optimistic";
import {
  useActiveWriteScopeId,
  useScopeStack,
} from "@executor-js/react/api/scope-context";
import { Button } from "@executor-js/react/components/button";
import { Skeleton } from "@executor-js/react/components/skeleton";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@executor-js/react/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@executor-js/react/components/dropdown-menu";
import { SourceFavicon } from "@executor-js/react/components/source-favicon";
import { CommandPalette } from "@executor-js/react/components/command-palette";
import { AUTH_PATHS } from "../auth/api";
import { useAuth } from "./auth";
import { useOrgRoute } from "./org-route";
import { useOptionalWorkspaceRoute } from "./workspace-route";
import { workspacesAtom } from "./workspaces";
import {
  CreateOrganizationFields,
  useCreateOrganizationForm,
} from "./components/create-organization-form";
import {
  CreateWorkspaceFields,
  useCreateWorkspaceForm,
} from "./components/create-workspace-form";

// ── ShellSkeleton ────────────────────────────────────────────────────────

export function ShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar skeleton */}
      <aside className="hidden w-52 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col lg:w-56">
        <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-4">
          <Skeleton className="h-4 w-20" />
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <div className="mt-5 mb-2 px-2.5">
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-11/12 rounded-md" />
            <Skeleton className="h-7 w-10/12 rounded-md" />
            <Skeleton className="h-7 w-9/12 rounded-md" />
          </div>
        </nav>
        <div className="shrink-0 border-t border-sidebar-border px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main content skeleton */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 md:hidden">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-4 w-20" />
          <div className="w-7 shrink-0" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── NavItem ──────────────────────────────────────────────────────────────

function NavItem(props: {
  to: string;
  params: Record<string, string>;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      // The Shell's static route templates don't enroll in TanStack's typed
      // Link param inference (we hand-pick `to` against the generated tree)
      // — `as never` lets us hand both the `to` template and `params` object
      // through without per-prop typing gymnastics.
      to={props.to as never}
      params={props.params as never}
      onClick={props.onNavigate}
      className={[
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        props.active
          ? "bg-sidebar-active text-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
      ].join(" ")}
    >
      {props.label}
    </Link>
  );
}

// ── SourceList ───────────────────────────────────────────────────────────

// A source in the listing — taken from the API response shape so we can
// reason about scope buckets and override state without a second type
// declaration. Mirrors `Source` from `@executor-js/sdk` minus optimistic
// flags added by `useSourcesWithPending`.
type SidebarSource = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly url?: string;
  readonly scopeId?: string;
  readonly overriddenBy?: string;
};

function SourceLink(props: {
  source: SidebarSource;
  pathname: string;
  orgHandle: string;
  workspaceSlug: string | null;
  onNavigate?: () => void;
  overridden?: boolean;
}) {
  const { source: s, pathname, orgHandle, workspaceSlug, onNavigate, overridden } = props;
  const detailPath = workspaceSlug
    ? `/${orgHandle}/${workspaceSlug}/sources/${s.id}`
    : `/${orgHandle}/sources/${s.id}`;
  const active = pathname === detailPath || pathname.startsWith(`${detailPath}/`);
  const to = workspaceSlug
    ? "/$org/$workspace/sources/$namespace"
    : "/$org/sources/$namespace";
  const params: Record<string, string> = workspaceSlug
    ? { org: orgHandle, workspace: workspaceSlug, namespace: s.id }
    : { org: orgHandle, namespace: s.id };
  return (
    <Link
      to={to as never}
      params={params as never}
      onClick={onNavigate}
      className={[
        "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
        overridden
          ? "text-muted-foreground opacity-60 hover:opacity-80"
          : active
            ? "bg-sidebar-active text-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
      ].join(" ")}
    >
      <SourceFavicon url={s.url} />
      <span className="flex-1 truncate">{s.name}</span>
      {overridden ? (
        <span className="rounded bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Overridden
        </span>
      ) : (
        <span className="rounded bg-secondary/50 px-1 py-px text-xs font-medium text-muted-foreground">
          {s.kind}
        </span>
      )}
    </Link>
  );
}

function SidebarSectionLabel(props: { children: ReactNode }) {
  return (
    <div className="mt-3 mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {props.children}
    </div>
  );
}

function SourceList(props: { pathname: string; onNavigate?: () => void }) {
  const { orgHandle } = useOrgRoute();
  const workspace = useOptionalWorkspaceRoute();
  const scopeId = useActiveWriteScopeId();
  const stack = useScopeStack();
  const sources = useSourcesWithPending(scopeId);

  // Identify which scopes count as "workspace bucket" vs "global bucket".
  // The executor builds the workspace stack as
  // `[user_workspace, workspace, user_org, org]`. Sources owned by either
  // of the first two scopes are workspace sources; the rest are global
  // (including `user-org` overrides, which v1 doesn't write but we won't
  // hide if they exist).
  const workspaceScopes = new Set<string>();
  const globalScopes = new Set<string>();
  if (workspace) {
    for (const s of stack) {
      if (s.id.startsWith("workspace_") || s.id.startsWith("user_workspace_")) {
        workspaceScopes.add(s.id);
      } else {
        globalScopes.add(s.id);
      }
    }
  }

  return AsyncResult.match(sources, {
    onInitial: () => (
      <div className="flex flex-col gap-1 px-2.5 py-1">
        {[80, 65, 72, 58, 68].map((w, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md py-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded" />
            <Skeleton className="h-3" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    ),
    onFailure: () => (
      <div className="px-2.5 py-2 text-xs text-muted-foreground">No sources yet</div>
    ),
    onSuccess: ({ value }) => {
      const all = value as readonly SidebarSource[];
      if (all.length === 0) {
        return (
          <div className="px-2.5 py-2 text-sm leading-relaxed text-muted-foreground">
            No sources yet
          </div>
        );
      }

      // Global context — flat list, no buckets.
      if (!workspace) {
        return (
          <div className="flex flex-col gap-px">
            {all.map((s) => (
              <SourceLink
                key={`${s.id}-${s.scopeId ?? "static"}`}
                source={s}
                pathname={props.pathname}
                orgHandle={orgHandle}
                workspaceSlug={null}
                onNavigate={props.onNavigate}
                overridden={Boolean(s.overriddenBy)}
              />
            ))}
          </div>
        );
      }

      // Workspace context — split into Workspace + Global buckets, with
      // shadowed global sources rendered as `Overridden` (still listed so
      // the user can see what's inherited and where the override comes
      // from).
      const ws: SidebarSource[] = [];
      const global: SidebarSource[] = [];
      for (const s of all) {
        if (s.scopeId && workspaceScopes.has(s.scopeId)) {
          ws.push(s);
        } else if (s.scopeId && globalScopes.has(s.scopeId)) {
          global.push(s);
        } else {
          // Static sources (no scopeId) and rows from scopes outside this
          // request's stack land in the global bucket — they're not owned
          // by the workspace.
          global.push(s);
        }
      }

      return (
        <div className="flex flex-col gap-px">
          <SidebarSectionLabel>Workspace</SidebarSectionLabel>
          {ws.length === 0 ? (
            <div className="px-2.5 py-1 text-xs text-muted-foreground">
              No workspace sources
            </div>
          ) : (
            ws.map((s) => (
              <SourceLink
                key={`${s.id}-${s.scopeId ?? "static"}`}
                source={s}
                pathname={props.pathname}
                orgHandle={orgHandle}
                workspaceSlug={workspace.workspaceSlug}
                onNavigate={props.onNavigate}
              />
            ))
          )}
          <SidebarSectionLabel>Global</SidebarSectionLabel>
          {global.length === 0 ? (
            <div className="px-2.5 py-1 text-xs text-muted-foreground">
              No global sources
            </div>
          ) : (
            global.map((s) => (
              <SourceLink
                key={`${s.id}-${s.scopeId ?? "static"}`}
                source={s}
                pathname={props.pathname}
                orgHandle={orgHandle}
                workspaceSlug={workspace.workspaceSlug}
                onNavigate={props.onNavigate}
                overridden={Boolean(s.overriddenBy)}
              />
            ))
          )}
        </div>
      );
    },
  });
}

// ── UserFooter ──────────────────────────────────────────────────────────

function initialsFor(name: string | null, email: string) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  return email[0]!.toUpperCase();
}

function Avatar(props: {
  url: string | null;
  name: string | null;
  email: string;
  size?: "sm" | "md";
}) {
  const size = props.size === "md" ? "size-8" : "size-7";
  const text = props.size === "md" ? "text-sm" : "text-xs";
  if (props.url) {
    return <img src={props.url} alt="" className={`${size} shrink-0 rounded-full`} />;
  }
  return (
    <div
      className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-primary/10 ${text} font-semibold text-primary`}
    >
      {initialsFor(props.name, props.email)}
    </div>
  );
}

// Per-org "Global / <workspace>" switcher items. Mirrors the structure laid
// out in the workspaces plan: `<orgName> / Global` pinned at the top, then a
// separator, then `<orgName> / <workspaceName>` for each workspace.
//
// The query for workspaces runs against the *active* org only (the
// CloudApiClient's baseUrl tracks the current `/$org` URL). For non-active
// orgs we just show the Global entry — switching to that org loads its
// workspaces fresh on next render.
function ContextSwitcherItems(props: {
  activeOrganizationId: string | null;
  activeWorkspaceId: string | null;
}) {
  const auth = useAuth();
  const workspacesResult = useAtomValue(workspacesAtom);
  const workspaces =
    AsyncResult.isSuccess(workspacesResult) ? workspacesResult.value.workspaces : null;

  if (auth.status !== "authenticated") {
    return <DropdownMenuItem disabled>Loading…</DropdownMenuItem>;
  }
  if (auth.organizations.length === 0) {
    return <DropdownMenuItem disabled>No organizations</DropdownMenuItem>;
  }

  return (
    <>
      {auth.organizations.map((organization) => {
        const isActiveOrg = organization.id === props.activeOrganizationId;
        const orgWorkspaces = isActiveOrg ? (workspaces ?? []) : [];
        const isGlobalActive = isActiveOrg && props.activeWorkspaceId === null;
        return (
          <div key={organization.id}>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {organization.name}
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={isGlobalActive}
              className="text-xs"
              asChild
            >
              <Link
                to="/$org"
                params={{ org: organization.handle }}
                className="flex w-full items-center gap-2"
              >
                <span className="min-w-0 flex-1 truncate">Global</span>
                {isGlobalActive && <CheckIcon />}
              </Link>
            </DropdownMenuItem>
            {orgWorkspaces.length > 0 && <DropdownMenuSeparator />}
            {orgWorkspaces.map((workspace) => {
              const isActive = workspace.id === props.activeWorkspaceId;
              return (
                <DropdownMenuItem
                  key={workspace.id}
                  disabled={isActive}
                  className="text-xs"
                  asChild
                >
                  <Link
                    to="/$org/$workspace"
                    params={{
                      org: organization.handle,
                      workspace: workspace.slug,
                    }}
                    className="flex w-full items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {workspace.name}
                    </span>
                    {isActive && <CheckIcon />}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="ml-auto size-3 text-muted-foreground">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserFooter() {
  const auth = useAuth();
  const orgRoute = useOrgRoute();
  const workspaceRoute = useOptionalWorkspaceRoute();
  const navigate = useNavigate();
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);

  const suggestedOrganizationName =
    auth.status === "authenticated" && auth.user.name?.trim() !== "" && auth.user.name != null
      ? `${auth.user.name}'s Organization`
      : "New Organization";

  const form = useCreateOrganizationForm({
    defaultName: suggestedOrganizationName,
    // The form returns the new org's handle on success — navigate via the URL
    // by reloading at the new handle. Once we wire useNavigate in here we can
    // do a soft navigation instead.
    onSuccess: (org) => {
      // Navigate to the new org's URL — the URL is the source of truth for
      // active org now, so a hard reload at the new handle re-renders the
      // shell with the right context.
      window.location.href = `/${org.handle}`;
    },
  });

  // Workspace name suggestion is intentionally generic — workspaces are
  // project-shaped, not user-shaped. The user can always rename later.
  const workspaceForm = useCreateWorkspaceForm({
    defaultName: "",
    onSuccess: (workspace) => {
      setCreateWorkspaceOpen(false);
      void navigate({
        to: "/$org/$workspace",
        params: { org: orgRoute.orgHandle, workspace: workspace.slug },
      });
    },
  });

  if (auth.status !== "authenticated") return null;

  const openCreateOrganization = () => {
    form.reset(suggestedOrganizationName);
    setCreateOrganizationOpen(true);
  };

  const openCreateWorkspace = () => {
    workspaceForm.reset("");
    setCreateWorkspaceOpen(true);
  };

  // Trigger label format per the plan: `<orgName> / Global` or
  // `<orgName> / <workspaceName>`. The org name is constant in this layout
  // (parent route resolves it); the workspace name only appears under
  // workspace context.
  const contextLabel = workspaceRoute
    ? `${orgRoute.orgName} / ${workspaceRoute.workspaceName}`
    : `${orgRoute.orgName} / Global`;

  return (
    <div className="shrink-0 border-t border-sidebar-border px-3 py-2.5">
      <Dialog
        open={createOrganizationOpen}
        onOpenChange={(open) => {
          setCreateOrganizationOpen(open);
          if (!open) form.reset(suggestedOrganizationName);
        }}
      >
        <Dialog
          open={createWorkspaceOpen}
          onOpenChange={(open) => {
            setCreateWorkspaceOpen(open);
            if (!open) workspaceForm.reset("");
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-1 py-1 text-left hover:bg-sidebar-active/60"
              >
                <Avatar url={auth.user.avatarUrl} name={auth.user.name} email={auth.user.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {auth.user.name ?? auth.user.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{contextLabel}</p>
                </div>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  className="size-3.5 shrink-0 text-muted-foreground"
                >
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Context
              </DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">
                  <span className="min-w-0 flex-1 truncate">{contextLabel}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <ContextSwitcherItems
                    activeOrganizationId={orgRoute.orgId}
                    activeWorkspaceId={workspaceRoute?.workspaceId ?? null}
                  />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={(event) => {
                      event.preventDefault();
                      openCreateWorkspace();
                    }}
                  >
                    Create workspace
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={(event) => {
                      event.preventDefault();
                      openCreateOrganization();
                    }}
                  >
                    Create organization
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Signed in as
              </DropdownMenuLabel>
              <DropdownMenuItem disabled className="gap-2 text-xs opacity-100">
                <Avatar url={auth.user.avatarUrl} name={auth.user.name} email={auth.user.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {auth.user.name ?? auth.user.email}
                  </p>
                  {auth.user.name && (
                    <p className="truncate text-muted-foreground">{auth.user.email}</p>
                  )}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs text-destructive focus:text-destructive"
                onClick={async () => {
                  await fetch(AUTH_PATHS.logout, { method: "POST" });
                  window.location.href = "/";
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">Create workspace</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Workspaces are project contexts inside {orgRoute.orgName}. They share global
                sources and add their own.
              </DialogDescription>
            </DialogHeader>

            <CreateWorkspaceFields
              name={workspaceForm.name}
              onNameChange={(name) => {
                workspaceForm.setName(name);
                if (workspaceForm.error) workspaceForm.setError(null);
              }}
              error={workspaceForm.error}
              onSubmit={() => void workspaceForm.submit()}
            />

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" size="sm" disabled={workspaceForm.creating}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                size="sm"
                onClick={() => void workspaceForm.submit()}
                disabled={!workspaceForm.canSubmit || workspaceForm.creating}
              >
                {workspaceForm.creating ? "Creating…" : "Create workspace"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create organization</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Add another organization under your current account and switch into it immediately.
            </DialogDescription>
          </DialogHeader>

          <CreateOrganizationFields
            name={form.name}
            onNameChange={(name) => {
              form.setName(name);
              if (form.error) form.setError(null);
            }}
            error={form.error}
            onSubmit={() => void form.submit()}
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm" disabled={form.creating}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={() => void form.submit()}
              disabled={!form.canSubmit || form.creating}
            >
              {form.creating ? "Creating…" : "Create organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── SidebarContent ───────────────────────────────────────────────────────

function SidebarContent(props: { pathname: string; onNavigate?: () => void; showBrand?: boolean }) {
  const { orgHandle } = useOrgRoute();
  const workspaceRoute = useOptionalWorkspaceRoute();

  const orgPrefix = `/${orgHandle}`;
  const inWorkspace = workspaceRoute !== null;
  const wsPrefix = inWorkspace
    ? `${orgPrefix}/${workspaceRoute.workspaceSlug}`
    : null;
  const navPrefix = wsPrefix ?? orgPrefix;

  const isHome = props.pathname === navPrefix || props.pathname === `${navPrefix}/`;
  const isSecrets = props.pathname === `${navPrefix}/secrets`;
  const isConnections = props.pathname === `${navPrefix}/connections`;
  const isPolicies = props.pathname === `${navPrefix}/policies`;
  // Org-admin paths (billing/settings) only render in global context — they
  // don't have workspace equivalents per the plan ("In workspace context, the
  // main working nav remains focused on sources, connections, secrets, and
  // policies").
  const isBilling =
    props.pathname === `${orgPrefix}/-/billing` ||
    props.pathname.startsWith(`${orgPrefix}/-/billing/`);
  const isOrg = props.pathname === `${orgPrefix}/-/settings`;

  // Build link targets. Workspace context uses the `/$org/$workspace/...`
  // routes; global context stays on `/$org/...`. Casting `to` and `params` is
  // localized to the union here and matches the existing `as never` pattern
  // NavItem already uses for hand-picked typed templates.
  type Link = { to: string; params: Record<string, string> };
  const sourcesLink: Link = inWorkspace
    ? {
        to: "/$org/$workspace",
        params: { org: orgHandle, workspace: workspaceRoute.workspaceSlug },
      }
    : { to: "/$org", params: { org: orgHandle } };
  const connectionsLink: Link = inWorkspace
    ? {
        to: "/$org/$workspace/connections",
        params: { org: orgHandle, workspace: workspaceRoute.workspaceSlug },
      }
    : { to: "/$org/connections", params: { org: orgHandle } };
  const secretsLink: Link = inWorkspace
    ? {
        to: "/$org/$workspace/secrets",
        params: { org: orgHandle, workspace: workspaceRoute.workspaceSlug },
      }
    : { to: "/$org/secrets", params: { org: orgHandle } };
  const policiesLink: Link = inWorkspace
    ? {
        to: "/$org/$workspace/policies",
        params: { org: orgHandle, workspace: workspaceRoute.workspaceSlug },
      }
    : { to: "/$org/policies", params: { org: orgHandle } };

  return (
    <>
      {props.showBrand !== false && (
        <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-4">
          <Link
            to={sourcesLink.to as never}
            params={sourcesLink.params as never}
            className="flex items-center gap-1.5"
          >
            <span className="font-display text-base tracking-tight text-foreground">executor</span>
          </Link>
        </div>
      )}

      <nav className="flex flex-1 flex-col overflow-y-auto p-2">
        <NavItem
          to={sourcesLink.to}
          params={sourcesLink.params}
          label="Sources"
          active={isHome}
          onNavigate={props.onNavigate}
        />
        <NavItem
          to={connectionsLink.to}
          params={connectionsLink.params}
          label="Connections"
          active={isConnections}
          onNavigate={props.onNavigate}
        />
        <NavItem
          to={secretsLink.to}
          params={secretsLink.params}
          label="Secrets"
          active={isSecrets}
          onNavigate={props.onNavigate}
        />
        <NavItem
          to={policiesLink.to}
          params={policiesLink.params}
          label="Policies"
          active={isPolicies}
          onNavigate={props.onNavigate}
        />
        {!inWorkspace && (
          <>
            <NavItem
              to="/$org/-/settings"
              params={{ org: orgHandle }}
              label="Organization"
              active={isOrg}
              onNavigate={props.onNavigate}
            />
            <NavItem
              to="/$org/-/billing"
              params={{ org: orgHandle }}
              label="Billing"
              active={isBilling}
              onNavigate={props.onNavigate}
            />
          </>
        )}

        <div className="mt-5 mb-1 px-2.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <span>Sources</span>
        </div>

        <SourceList pathname={props.pathname} onNavigate={props.onNavigate} />
      </nav>

      <UserFooter />
    </>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────

export function Shell() {
  const { orgHandle } = useOrgRoute();
  const workspaceRoute = useOptionalWorkspaceRoute();
  const location = useLocation();
  const pathname = location.pathname;
  const lastPathname = useRef(pathname);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  if (lastPathname.current !== pathname) {
    lastPathname.current = pathname;
    if (mobileSidebarOpen) setMobileSidebarOpen(false);
  }
  const homeLink: { to: string; params: Record<string, string> } = workspaceRoute
    ? {
        to: "/$org/$workspace",
        params: { org: orgHandle, workspace: workspaceRoute.workspaceSlug },
      }
    : { to: "/$org", params: { org: orgHandle } };

  // Lock scroll when mobile sidebar open
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileSidebarOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      <CommandPalette />
      {/* Desktop sidebar */}
      <aside className="hidden w-52 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col lg:w-56">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* oxlint-disable-next-line react/forbid-elements */}
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative flex h-full w-[84vw] max-w-xs flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
              <Link
                to={homeLink.to as never}
                params={homeLink.params as never}
                className="flex items-center gap-1.5"
              >
                <span className="font-display text-base tracking-tight text-foreground">
                  executor
                </span>
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileSidebarOpen(false)}
                className="text-sidebar-foreground hover:bg-sidebar-active hover:text-foreground"
              >
                <svg viewBox="0 0 16 16" className="size-3.5">
                  <path
                    d="M3 3l10 10M13 3L3 13"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </Button>
            </div>
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMobileSidebarOpen(false)}
              showBrand={false}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 md:hidden">
          <Button
            variant="outline"
            size="icon-sm"
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileSidebarOpen(true)}
            className="bg-card hover:bg-accent/50"
          >
            <svg viewBox="0 0 16 16" className="size-4">
              <path
                d="M2 4h12M2 8h12M2 12h12"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </Button>
          <Link
            to={homeLink.to as never}
            params={homeLink.params as never}
            className="flex items-center gap-1.5"
          >
            <span className="font-display text-base tracking-tight text-foreground">executor</span>
          </Link>
          <div className="w-8 shrink-0" />
        </div>

        <Outlet />
      </main>
    </div>
  );
}
