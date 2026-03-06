import {
  type ControlPlaneServiceShape,
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "#api";
import {
  ControlPlanePersistenceError,
  type SqlControlPlaneRows,
} from "#persistence";
import type {
  Organization,
  OrganizationMembership,
  Policy,
  Source,
  SourceId,
  SourceCredentialBinding,
  Workspace,
} from "#schema";
import {
  OrganizationIdSchema,
  OrganizationMemberIdSchema,
  PolicyIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { type ResolveExecutionEnvironment } from "./execution-state";
import { type LiveExecutionManager } from "./live-execution";
import { createRuntimeExecutionsService } from "./execution-service";
import { loadLocalInstallation } from "./local-installation";
import { type RuntimeSourceAuthService } from "./source-auth-service";
import {
  createSourceFromPayload,
  projectSourceFromStorage,
  projectSourcesFromStorage,
  splitSourceForStorage,
  updateSourceFromPayload,
} from "./source-definitions";
import { slugify } from "./slug";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const badRequest = (
  operation: string,
  message: string,
  details: string,
): ControlPlaneBadRequestError =>
  new ControlPlaneBadRequestError({
    operation,
    message,
    details,
  });

const notFound = (
  operation: string,
  message: string,
  details: string,
): ControlPlaneNotFoundError =>
  new ControlPlaneNotFoundError({
    operation,
    message,
    details,
  });

const storageFromPersistence = (
  operation: string,
  error: ControlPlanePersistenceError,
): ControlPlaneStorageError =>
  new ControlPlaneStorageError({
    operation,
    message: error.message,
    details: error.details ?? "Persistence operation failed",
  });

const toUnknownPersistenceError = (
  operation: string,
  cause: unknown,
  details: string,
): ControlPlanePersistenceError =>
  new ControlPlanePersistenceError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    details,
    code: null,
    constraint: null,
    table: null,
    kind: "unknown",
    cause,
  });

const isUniqueViolation = (error: ControlPlanePersistenceError): boolean =>
  error.kind === "unique_violation";

const mapPersistenceError = <A>(
  operation: string,
  effect: Effect.Effect<A, ControlPlanePersistenceError>,
): Effect.Effect<A, ControlPlaneBadRequestError | ControlPlaneStorageError> =>
  effect.pipe(
    Effect.mapError((error) =>
      isUniqueViolation(error)
        ? badRequest(operation, "Unique constraint violation", error.details ?? "duplicate key")
        : storageFromPersistence(operation, error),
    ),
  );

const mapStorageError = <A>(
  operation: string,
  effect: Effect.Effect<A, ControlPlanePersistenceError>,
): Effect.Effect<A, ControlPlaneStorageError> =>
  effect.pipe(
    Effect.mapError((error) => storageFromPersistence(operation, error)),
  );

const requireTrimmed = (
  operation: string,
  fieldName: string,
  value: string,
): Effect.Effect<string, ControlPlaneBadRequestError> => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return Effect.fail(
      badRequest(
        operation,
        `Invalid ${fieldName}`,
        `${fieldName} must be a non-empty string`,
      ),
    );
  }

  return Effect.succeed(trimmed);
};

const parseJsonString = (
  operation: string,
  fieldName: string,
  value: string,
): Effect.Effect<string, ControlPlaneBadRequestError> =>
  Effect.try({
    try: () => {
      JSON.parse(value);
      return value;
    },
    catch: () =>
      badRequest(operation, `Invalid ${fieldName}`, `${fieldName} must be valid JSON`),
  });

const ensureUniqueOrganizationSlug = (
  rows: SqlControlPlaneRows,
  baseName: string,
): Effect.Effect<string, ControlPlaneStorageError> =>
  Effect.gen(function* () {
    const normalized = slugify(baseName);
    const seed = normalized.length > 0 ? normalized : "item";

    let counter = 0;
    while (true) {
      const candidate = counter === 0 ? seed : `${seed}-${counter + 1}`;

      const existing = yield* mapStorageError(
        "organizations.create.slug_lookup",
        rows.organizations.getBySlug(candidate as Organization["slug"]),
      );

      if (Option.isNone(existing)) {
        return candidate;
      }

      counter += 1;
    }
  });

const ensureOrganizationExists = (
  rows: SqlControlPlaneRows,
  operation: string,
  organizationId: Organization["id"],
): Effect.Effect<Organization, ControlPlaneNotFoundError | ControlPlaneStorageError> =>
  Effect.gen(function* () {
    const organization = yield* mapStorageError(
      `${operation}.organization_lookup`,
      rows.organizations.getById(organizationId),
    );

    if (Option.isNone(organization)) {
      return yield* Effect.fail(
        notFound(operation, "Organization not found", `organizationId=${organizationId}`),
      );
    }

    return organization.value;
  });

const createOrganizationsService = (
  rows: SqlControlPlaneRows,
): Pick<
  ControlPlaneServiceShape,
  | "listOrganizations"
  | "createOrganization"
  | "getOrganization"
  | "updateOrganization"
  | "removeOrganization"
> => ({
    listOrganizations: ({ accountId }) =>
      Effect.gen(function* () {
        const memberships = yield* mapStorageError(
          "organizations.list.memberships",
          rows.organizationMemberships.listByAccountId(accountId),
        );

        const activeOrganizationIds = Array.from(
          new Set(
            memberships
              .filter((membership) => membership.status === "active")
              .map((membership) => membership.organizationId),
          ),
        );

        const organizations = yield* Effect.forEach(activeOrganizationIds, (organizationId) =>
          mapStorageError(
            "organizations.list.organization",
            rows.organizations.getById(organizationId),
          ).pipe(
            Effect.map((result) => (Option.isSome(result) ? result.value : null)),
          ));

        return organizations.filter((organization): organization is Organization => organization !== null);
      }),

    createOrganization: ({ payload, createdByAccountId }) =>
      Effect.gen(function* () {
        const name = yield* requireTrimmed(
          "organizations.create",
          "name",
          payload.name,
        );
        const now = Date.now();

        const slug = payload.slug
          ? yield* requireTrimmed("organizations.create", "slug", payload.slug)
          : yield* ensureUniqueOrganizationSlug(rows, name);

        const organization: Organization = {
          id: OrganizationIdSchema.make(`org_${crypto.randomUUID()}`),
          slug,
          name,
          status: "active",
          createdByAccountId: createdByAccountId ?? null,
          createdAt: now,
          updatedAt: now,
        };

        const ownerMembership: OrganizationMembership | null = createdByAccountId
          ? {
              id: OrganizationMemberIdSchema.make(`org_mem_${crypto.randomUUID()}`),
              organizationId: organization.id,
              accountId: createdByAccountId,
              role: "owner",
              status: "active",
              billable: true,
              invitedByAccountId: null,
              joinedAt: now,
              createdAt: now,
              updatedAt: now,
            }
          : null;

        yield* mapPersistenceError(
          "organizations.create",
          rows.organizations.insertWithOwnerMembership(organization, ownerMembership),
        );

        return organization;
      }),

    getOrganization: ({ organizationId, accountId }) =>
      Effect.gen(function* () {
        const membership = yield* mapStorageError(
          "organizations.get.membership",
          rows.organizationMemberships.getByOrganizationAndAccount(organizationId, accountId),
        );

        if (Option.isNone(membership) || membership.value.status !== "active") {
          return yield* Effect.fail(
            notFound(
              "organizations.get",
              "Organization not found",
              `organizationId=${organizationId}`,
            ),
          );
        }

        const existing = yield* mapStorageError(
          "organizations.get",
          rows.organizations.getById(organizationId),
        );

        if (Option.isNone(existing)) {
          return yield* Effect.fail(
            notFound(
              "organizations.get",
              "Organization not found",
              `organizationId=${organizationId}`,
            ),
          );
        }

        return existing.value;
      }),

    updateOrganization: ({ organizationId, payload }) =>
      Effect.gen(function* () {
        const patch: Partial<Omit<Mutable<Organization>, "id" | "createdAt">> = {
          updatedAt: Date.now(),
        };

        if (payload.name !== undefined) {
          patch.name = yield* requireTrimmed(
            "organizations.update",
            "name",
            payload.name,
          );
        }
        if (payload.status !== undefined) {
          patch.status = payload.status;
        }

        const updated = yield* mapPersistenceError(
          "organizations.update",
          rows.organizations.update(organizationId, patch),
        );

        if (Option.isNone(updated)) {
          return yield* Effect.fail(
            notFound(
              "organizations.update",
              "Organization not found",
              `organizationId=${organizationId}`,
            ),
          );
        }

        return updated.value;
      }),

    removeOrganization: ({ organizationId }) =>
      mapStorageError(
        "organizations.remove",
        rows.organizations.removeTreeById(organizationId),
      ).pipe(Effect.map((removed) => ({ removed }))),
  });

const createMembershipsService = (
  rows: SqlControlPlaneRows,
): Pick<
  ControlPlaneServiceShape,
  | "listMemberships"
  | "createMembership"
  | "updateMembership"
  | "removeMembership"
> => ({
    listMemberships: (organizationId) =>
      Effect.gen(function* () {
        yield* ensureOrganizationExists(rows, "memberships.list", organizationId);

        return yield* mapStorageError(
          "memberships.list",
          rows.organizationMemberships.listByOrganizationId(organizationId),
        );
      }),

    createMembership: ({ organizationId, payload }) =>
      Effect.gen(function* () {
        yield* ensureOrganizationExists(rows, "memberships.create", organizationId);

        const now = Date.now();
        const membership: OrganizationMembership = {
          id: OrganizationMemberIdSchema.make(`org_mem_${crypto.randomUUID()}`),
          organizationId,
          accountId: payload.accountId,
          role: payload.role,
          status: payload.status ?? "active",
          billable: payload.billable ?? true,
          invitedByAccountId: payload.invitedByAccountId ?? null,
          joinedAt: (payload.status ?? "active") === "active" ? now : null,
          createdAt: now,
          updatedAt: now,
        };

        yield* mapPersistenceError(
          "memberships.create",
          rows.organizationMemberships.upsert(membership),
        );

        const stored = yield* mapStorageError(
          "memberships.create",
          rows.organizationMemberships.getByOrganizationAndAccount(
            organizationId,
            payload.accountId,
          ),
        );
        if (Option.isNone(stored)) {
          return yield* Effect.fail(
            new ControlPlaneStorageError({
              operation: "memberships.create",
              message: "Membership was not persisted",
              details: `organizationId=${organizationId} accountId=${payload.accountId}`,
            }),
          );
        }

        return stored.value;
      }),

    updateMembership: ({ organizationId, accountId, payload }) =>
      Effect.gen(function* () {
        yield* ensureOrganizationExists(rows, "memberships.update", organizationId);

        const existing = yield* mapStorageError(
          "memberships.update",
          rows.organizationMemberships.getByOrganizationAndAccount(
            organizationId,
            accountId,
          ),
        );

        if (Option.isNone(existing)) {
          return yield* Effect.fail(
            badRequest(
              "memberships.update",
              "Membership not found",
              `organizationId=${organizationId} accountId=${accountId}`,
            ),
          );
        }

        const current = existing.value;
        const now = Date.now();
        const next: OrganizationMembership = {
          ...current,
          role: payload.role ?? current.role,
          status: payload.status ?? current.status,
          billable: payload.billable ?? current.billable,
          joinedAt:
            (payload.status ?? current.status) === "active"
              ? (current.joinedAt ?? now)
              : current.joinedAt,
          updatedAt: now,
        };

        yield* mapPersistenceError(
          "memberships.update",
          rows.organizationMemberships.upsert(next),
        );

        return next;
      }),

    removeMembership: ({ organizationId, accountId }) =>
      Effect.gen(function* () {
        yield* ensureOrganizationExists(rows, "memberships.remove", organizationId);

        const removed = yield* mapStorageError(
          "memberships.remove",
          rows.organizationMemberships.removeByOrganizationAndAccount(
            organizationId,
            accountId,
          ),
        );

        return { removed };
      }),
  });

const createWorkspacesService = (
  rows: SqlControlPlaneRows,
): Pick<
  ControlPlaneServiceShape,
  | "listWorkspaces"
  | "createWorkspace"
  | "getWorkspace"
  | "updateWorkspace"
  | "removeWorkspace"
> => ({
    listWorkspaces: (organizationId) =>
      Effect.gen(function* () {
        yield* ensureOrganizationExists(rows, "workspaces.list", organizationId);

        return yield* mapStorageError(
          "workspaces.list",
          rows.workspaces.listByOrganizationId(organizationId),
        );
      }),

    createWorkspace: ({ organizationId, payload, createdByAccountId }) =>
      Effect.gen(function* () {
        yield* ensureOrganizationExists(rows, "workspaces.create", organizationId);

        const name = yield* requireTrimmed(
          "workspaces.create",
          "name",
          payload.name,
        );
        const now = Date.now();

        const workspace: Workspace = {
          id: WorkspaceIdSchema.make(`ws_${crypto.randomUUID()}`),
          organizationId,
          name,
          createdByAccountId: createdByAccountId ?? null,
          createdAt: now,
          updatedAt: now,
        };

        yield* mapPersistenceError(
          "workspaces.create",
          rows.workspaces.insert(workspace),
        );

        return workspace;
      }),

    getWorkspace: (workspaceId) =>
      Effect.gen(function* () {
        const existing = yield* mapStorageError(
          "workspaces.get",
          rows.workspaces.getById(workspaceId),
        );

        if (Option.isNone(existing)) {
          return yield* Effect.fail(
            notFound(
              "workspaces.get",
              "Workspace not found",
              `workspaceId=${workspaceId}`,
            ),
          );
        }

        return existing.value;
      }),

    updateWorkspace: ({ workspaceId, payload }) =>
      Effect.gen(function* () {
        const patch: Partial<
          Omit<Mutable<Workspace>, "id" | "organizationId" | "createdAt">
        > = {
          updatedAt: Date.now(),
        };

        if (payload.name !== undefined) {
          patch.name = yield* requireTrimmed(
            "workspaces.update",
            "name",
            payload.name,
          );
        }

        const updated = yield* mapPersistenceError(
          "workspaces.update",
          rows.workspaces.update(workspaceId, patch),
        );

        if (Option.isNone(updated)) {
          return yield* Effect.fail(
            notFound(
              "workspaces.update",
              "Workspace not found",
              `workspaceId=${workspaceId}`,
            ),
          );
        }

        return updated.value;
      }),

    removeWorkspace: ({ workspaceId }) =>
      mapStorageError(
        "workspaces.remove",
        rows.workspaces.removeById(workspaceId),
      ).pipe(Effect.map((removed) => ({ removed }))),
  });

const createSourcesService = (
  rows: SqlControlPlaneRows,
): Pick<
  ControlPlaneServiceShape,
  | "listSources"
  | "createSource"
  | "getSource"
  | "updateSource"
  | "removeSource"
> => ({
    listSources: (workspaceId) =>
      Effect.gen(function* () {
        const sourceRecords = yield* mapStorageError(
          "sources.list.records",
          rows.sources.listByWorkspaceId(workspaceId),
        );
        const credentialBindings = yield* mapStorageError(
          "sources.list.bindings",
          rows.sourceCredentialBindings.listByWorkspaceId(workspaceId),
        );

        return yield* projectSourcesFromStorage({
          sourceRecords,
          credentialBindings,
        }).pipe(
          Effect.mapError((error) =>
            storageFromPersistence(
              "sources.list",
              toUnknownPersistenceError(
                "sources.list",
                error,
                "Failed projecting stored sources",
              ),
            ),
          ),
        );
      }),

    createSource: ({ workspaceId, payload }) =>
      Effect.gen(function* () {
        const name = yield* requireTrimmed(
          "sources.create",
          "name",
          payload.name,
        );
        const endpoint = yield* requireTrimmed(
          "sources.create",
          "endpoint",
          payload.endpoint,
        );
        const now = Date.now();

        const source = yield* createSourceFromPayload({
          workspaceId,
          sourceId: SourceIdSchema.make(`src_${crypto.randomUUID()}`),
          payload: {
            ...payload,
            name,
            endpoint,
          },
          now,
        }).pipe(
          Effect.mapError((cause) =>
            badRequest(
              "sources.create",
              "Invalid source definition",
              cause instanceof Error ? cause.message : String(cause),
            ),
          ),
        );

        const { sourceRecord, credentialBinding } = splitSourceForStorage({
          source,
        });

        yield* mapPersistenceError("sources.create.source", rows.sources.insert(sourceRecord));
        if (credentialBinding !== null) {
          yield* mapPersistenceError(
            "sources.create.binding",
            rows.sourceCredentialBindings.upsert(credentialBinding),
          );
        }

        return source;
      }),

    getSource: ({ workspaceId, sourceId }) =>
      Effect.gen(function* () {
        const existing = yield* mapStorageError(
          "sources.get",
          rows.sources.getByWorkspaceAndId(workspaceId, sourceId),
        );

        if (Option.isNone(existing)) {
          return yield* Effect.fail(
            notFound(
              "sources.get",
              "Source not found",
              `workspaceId=${workspaceId} sourceId=${sourceId}`,
            ),
          );
        }

        const credentialBinding = yield* mapStorageError(
          "sources.get.binding",
          rows.sourceCredentialBindings.getByWorkspaceAndSourceId(workspaceId, sourceId),
        );

        return yield* projectSourceFromStorage({
          sourceRecord: existing.value,
          credentialBinding: Option.isSome(credentialBinding) ? credentialBinding.value : null,
        }).pipe(
          Effect.mapError((cause) =>
            storageFromPersistence(
              "sources.get",
              toUnknownPersistenceError(
                "sources.get",
                cause,
                "Failed projecting stored source",
              ),
            ),
          ),
        );
      }),

    updateSource: ({ workspaceId, sourceId, payload }) =>
      Effect.gen(function* () {
        const existing = yield* mapStorageError(
          "sources.update.existing",
          rows.sources.getByWorkspaceAndId(workspaceId, sourceId),
        );

        if (Option.isNone(existing)) {
          return yield* Effect.fail(
            notFound(
              "sources.update",
              "Source not found",
              `workspaceId=${workspaceId} sourceId=${sourceId}`,
            ),
          );
        }

        const existingBinding = yield* mapStorageError(
          "sources.update.binding",
          rows.sourceCredentialBindings.getByWorkspaceAndSourceId(workspaceId, sourceId),
        );

        const existingSource = yield* projectSourceFromStorage({
          sourceRecord: existing.value,
          credentialBinding: Option.isSome(existingBinding) ? existingBinding.value : null,
        }).pipe(
          Effect.mapError((cause) =>
            storageFromPersistence(
              "sources.update",
              toUnknownPersistenceError(
                "sources.update",
                cause,
                "Failed projecting stored source",
              ),
            ),
          ),
        );

        const normalizedPayload = {
          ...payload,
          ...(payload.name !== undefined
            ? {
                name: yield* requireTrimmed("sources.update", "name", payload.name),
              }
            : {}),
          ...(payload.endpoint !== undefined
            ? {
                endpoint: yield* requireTrimmed(
                  "sources.update",
                  "endpoint",
                  payload.endpoint,
                ),
              }
            : {}),
        };

        const updatedSource = yield* updateSourceFromPayload({
          source: existingSource,
          payload: normalizedPayload,
          now: Date.now(),
        }).pipe(
          Effect.mapError((cause) =>
            badRequest(
              "sources.update",
              "Invalid source definition",
              cause instanceof Error ? cause.message : String(cause),
            ),
          ),
        );

        const { sourceRecord, credentialBinding } = splitSourceForStorage({
          source: updatedSource,
        });

        const stored = yield* mapPersistenceError(
          "sources.update.source",
          rows.sources.update(workspaceId, sourceId, {
            ...sourceRecord,
            updatedAt: updatedSource.updatedAt,
          }),
        );

        if (Option.isNone(stored)) {
          return yield* Effect.fail(
            notFound(
              "sources.update",
              "Source not found",
              `workspaceId=${workspaceId} sourceId=${sourceId}`,
            ),
          );
        }

        if (credentialBinding === null) {
          yield* mapStorageError(
            "sources.update.binding.remove",
            rows.sourceCredentialBindings.removeByWorkspaceAndSourceId(workspaceId, sourceId),
          );
        } else {
          yield* mapPersistenceError(
            "sources.update.binding",
            rows.sourceCredentialBindings.upsert(credentialBinding),
          );
        }

        return updatedSource;
      }),

    removeSource: ({ workspaceId, sourceId }) =>
      mapStorageError(
        "sources.remove",
        rows.sources.removeByWorkspaceAndId(workspaceId, sourceId),
      ).pipe(Effect.map((removed) => ({ removed }))),
  });

const createPoliciesService = (
  rows: SqlControlPlaneRows,
): Pick<
  ControlPlaneServiceShape,
  | "listPolicies"
  | "createPolicy"
  | "getPolicy"
  | "updatePolicy"
  | "removePolicy"
> => ({
    listPolicies: (workspaceId) =>
      mapStorageError(
        "policies.list",
        rows.policies.listByWorkspaceId(workspaceId),
      ),

    createPolicy: ({ workspaceId, payload }) =>
      Effect.gen(function* () {
        const now = Date.now();

        const policy: Policy = {
          id: PolicyIdSchema.make(`pol_${crypto.randomUUID()}`),
          workspaceId,
          targetAccountId: payload.targetAccountId ?? null,
          clientId: payload.clientId ?? null,
          resourceType: payload.resourceType ?? "tool_path",
          resourcePattern:
            payload.resourcePattern && payload.resourcePattern.trim().length > 0
              ? payload.resourcePattern.trim()
              : "*",
          matchType: payload.matchType ?? "glob",
          effect: payload.effect ?? "allow",
          approvalMode: payload.approvalMode ?? "auto",
          argumentConditionsJson: payload.argumentConditionsJson ?? null,
          priority: payload.priority ?? 0,
          enabled: payload.enabled ?? true,
          createdAt: now,
          updatedAt: now,
        };

        if (policy.argumentConditionsJson !== null) {
          yield* parseJsonString(
            "policies.create",
            "argumentConditionsJson",
            policy.argumentConditionsJson,
          );
        }

        yield* mapPersistenceError(
          "policies.create",
          rows.policies.insert(policy),
        );

        return policy;
      }),

    getPolicy: ({ workspaceId, policyId }) =>
      Effect.gen(function* () {
        const existing = yield* mapStorageError(
          "policies.get",
          rows.policies.getById(policyId),
        );

        if (Option.isNone(existing) || existing.value.workspaceId !== workspaceId) {
          return yield* Effect.fail(
            notFound(
              "policies.get",
              "Policy not found",
              `workspaceId=${workspaceId} policyId=${policyId}`,
            ),
          );
        }

        return existing.value;
      }),

    updatePolicy: ({ workspaceId, policyId, payload }) =>
      Effect.gen(function* () {
        const existing = yield* mapStorageError(
          "policies.update",
          rows.policies.getById(policyId),
        );
        if (Option.isNone(existing) || existing.value.workspaceId !== workspaceId) {
          return yield* Effect.fail(
            notFound(
              "policies.update",
              "Policy not found",
              `workspaceId=${workspaceId} policyId=${policyId}`,
            ),
          );
        }

        const patch: Partial<Omit<Mutable<Policy>, "id" | "workspaceId" | "createdAt">> = {
          updatedAt: Date.now(),
        };

        if (payload.targetAccountId !== undefined) {
          patch.targetAccountId = payload.targetAccountId;
        }
        if (payload.clientId !== undefined) {
          patch.clientId = payload.clientId;
        }
        if (payload.resourceType !== undefined) {
          patch.resourceType = payload.resourceType;
        }
        if (payload.resourcePattern !== undefined) {
          patch.resourcePattern = payload.resourcePattern;
        }
        if (payload.matchType !== undefined) {
          patch.matchType = payload.matchType;
        }
        if (payload.effect !== undefined) {
          patch.effect = payload.effect;
        }
        if (payload.approvalMode !== undefined) {
          patch.approvalMode = payload.approvalMode;
        }
        if (payload.argumentConditionsJson !== undefined) {
          if (payload.argumentConditionsJson !== null) {
            yield* parseJsonString(
              "policies.update",
              "argumentConditionsJson",
              payload.argumentConditionsJson,
            );
          }
          patch.argumentConditionsJson = payload.argumentConditionsJson;
        }
        if (payload.priority !== undefined) {
          patch.priority = payload.priority;
        }
        if (payload.enabled !== undefined) {
          patch.enabled = payload.enabled;
        }

        const updated = yield* mapPersistenceError(
          "policies.update",
          rows.policies.update(policyId, patch),
        );
        if (Option.isNone(updated)) {
          return yield* Effect.fail(
            notFound(
              "policies.update",
              "Policy not found",
              `workspaceId=${workspaceId} policyId=${policyId}`,
            ),
          );
        }

        return updated.value;
      }),

    removePolicy: ({ workspaceId, policyId }) =>
      Effect.gen(function* () {
        const existing = yield* mapStorageError(
          "policies.remove",
          rows.policies.getById(policyId),
        );
        if (Option.isNone(existing) || existing.value.workspaceId !== workspaceId) {
          return { removed: false };
        }

        const removed = yield* mapStorageError(
          "policies.remove",
          rows.policies.removeById(policyId),
        );

        return { removed };
      }),
  });

const createLocalService = (
  rows: SqlControlPlaneRows,
  sourceAuthService?: RuntimeSourceAuthService,
): Pick<ControlPlaneServiceShape, "getLocalInstallation" | "completeSourceAuthCallback"> => ({
    getLocalInstallation: () =>
      Effect.gen(function* () {
        const installation = yield* loadLocalInstallation(rows).pipe(
          Effect.mapError((error) =>
            error instanceof ControlPlanePersistenceError
              ? storageFromPersistence("local.installation.get", error)
              : new ControlPlaneStorageError({
                  operation: "local.installation.get",
                  message: error instanceof Error ? error.message : String(error),
                  details: "Failed loading local installation",
                }),
          ),
        );

        if (installation === null) {
          return yield* Effect.fail(
            notFound(
              "local.installation.get",
              "Local installation not found",
              "No local installation has been provisioned",
            ),
          );
        }

        return installation;
      }),

    completeSourceAuthCallback: (input) =>
      Effect.gen(function* () {
        if (!sourceAuthService) {
          return yield* Effect.fail(
            badRequest(
              "local.oauth.callback",
              "Source auth callback handling is unavailable",
              "Runtime source auth service is not configured",
            ),
          );
        }

        return yield* sourceAuthService.completeSourceAuthCallback(input).pipe(
          Effect.mapError((error) =>
            new ControlPlaneStorageError({
              operation: "local.oauth.callback",
              message: error instanceof Error ? error.message : String(error),
              details: "Failed completing source auth callback",
            }),
          ),
        );
      }),
  });

export const createRuntimeControlPlaneService = (
  rows: SqlControlPlaneRows,
  options: {
    executionResolver?: ResolveExecutionEnvironment;
    liveExecutionManager?: LiveExecutionManager;
    sourceAuthService?: RuntimeSourceAuthService;
  } = {},
): ControlPlaneServiceShape => ({
  ...createLocalService(rows, options.sourceAuthService),
  ...createOrganizationsService(rows),
  ...createMembershipsService(rows),
  ...createWorkspacesService(rows),
  ...createSourcesService(rows),
  ...createPoliciesService(rows),
  ...createRuntimeExecutionsService(
    rows,
    options.executionResolver,
    options.liveExecutionManager,
  ),
});
