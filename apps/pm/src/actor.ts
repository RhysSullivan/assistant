import {
  ControlPlaneActorResolverLive,
  deriveWorkspaceMembershipsForPrincipal,
  requirePrincipalFromHeaders,
} from "@executor-v2/management-api";
import {
  ActorUnauthenticatedError,
  makeActor,
  makeAllowAllActor,
} from "@executor-v2/domain";
import { type SqlControlPlanePersistence } from "@executor-v2/persistence-sql";
import {
  type OrganizationMembership,
  type Workspace,
  type WorkspaceMembership,
} from "@executor-v2/schema";
import * as PlatformHeaders from "@effect/platform/Headers";
import * as Effect from "effect/Effect";

type ActorRows = Pick<
  SqlControlPlanePersistence["rows"],
  "organizationMemberships" | "workspaces"
>;

const isTruthy = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const localAdminFallbackEnabled = (() => {
  const configured = process.env.PM_ALLOW_LOCAL_ADMIN;

  if (configured === undefined || configured.trim().length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  return isTruthy(configured);
})();

const workspaceMembershipsForAccount = (
  workspaces: ReadonlyArray<Workspace>,
  accountId: OrganizationMembership["accountId"],
  organizationMemberships: ReadonlyArray<OrganizationMembership>,
): ReadonlyArray<WorkspaceMembership> =>
  workspaces.flatMap((workspace) =>
    deriveWorkspaceMembershipsForPrincipal({
      principalAccountId: accountId,
      workspaceId: workspace.id,
      workspace,
      organizationMemberships,
    }),
  );

const resolveActorFromSnapshot = (
  rows: ActorRows,
  headers: PlatformHeaders.Headers,
) =>
  Effect.gen(function* () {
    const principal = yield* requirePrincipalFromHeaders(headers);

    const memberships = yield* rows.organizationMemberships
      .listByAccountId(principal.accountId)
      .pipe(
        Effect.mapError(
          (error) =>
            new ActorUnauthenticatedError({
              message: `Unable to read local auth state (${error.operation})`,
            }),
        ),
      );

    const organizationIds = memberships.map((membership) => membership.organizationId);

    const workspaces = yield* rows.workspaces.listByOrganizationIds(organizationIds).pipe(
      Effect.mapError(
        (error) =>
          new ActorUnauthenticatedError({
            message: `Unable to read local auth state (${error.operation})`,
          }),
      ),
    );

    if (memberships.length === 0 && workspaces.length === 0 && localAdminFallbackEnabled) {
      return makeAllowAllActor(principal);
    }

    const organizationMemberships = memberships;
    const workspaceMemberships = workspaceMembershipsForAccount(
      workspaces,
      principal.accountId,
      organizationMemberships,
    );

    return yield* makeActor({
      principal,
      workspaceMemberships,
      organizationMemberships,
    });
  });

export const PmActorLive = (rows: ActorRows) =>
  ControlPlaneActorResolverLive({
    resolveActor: (input) => resolveActorFromSnapshot(rows, input.headers),
    resolveWorkspaceActor: (input) =>
      Effect.gen(function* () {
        const principal = yield* requirePrincipalFromHeaders(input.headers);

        const memberships = yield* rows.organizationMemberships
          .listByAccountId(principal.accountId)
          .pipe(
            Effect.mapError(
              (error) =>
                new ActorUnauthenticatedError({
                  message: `Unable to read local auth state (${error.operation})`,
                }),
            ),
          );

        const organizationIds = memberships.map((membership) => membership.organizationId);
        const workspaces = yield* rows.workspaces.listByOrganizationIds(organizationIds).pipe(
          Effect.mapError(
            (error) =>
              new ActorUnauthenticatedError({
                message: `Unable to read local auth state (${error.operation})`,
              }),
          ),
        );

        if (memberships.length === 0 && workspaces.length === 0 && localAdminFallbackEnabled) {
          return makeAllowAllActor(principal);
        }

        const organizationMemberships = memberships;

        const workspace = workspaces.find((item) => item.id === input.workspaceId) ?? null;

        const workspaceMemberships = deriveWorkspaceMembershipsForPrincipal({
          principalAccountId: principal.accountId,
          workspaceId: input.workspaceId,
          workspace,
          organizationMemberships,
        });

        return yield* makeActor({
          principal,
          workspaceMemberships,
          organizationMemberships,
        });
      }),
  });
