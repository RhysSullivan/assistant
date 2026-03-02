import { type SqlControlPlanePersistence } from "@executor-v2/persistence-sql";
import {
  makeControlPlaneCredentialsService,
  type ControlPlaneCredentialsServiceShape,
} from "@executor-v2/management-api";
import {
  type AuthConnection,
  type AuthMaterial,
  type OAuthState,
  type SourceAuthBinding,
  type SourceCredentialBinding,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { createSqlSourceStoreErrorMapper } from "./control-plane-row-helpers";
import {
  buildOAuthRefreshConfigFromPayload,
  encodeOAuthRefreshConfig,
  normalizeString,
  parseOAuthRefreshConfig,
  sortCredentialBindings,
  sourceIdFromSourceKey,
  sourceKeyFromSourceId,
  strategyFromProvider,
  toCompatSourceCredentialBinding,
} from "./credentials-helpers";

type CredentialRows = Pick<
  SqlControlPlanePersistence["rows"],
  | "workspaces"
  | "authConnections"
  | "sourceAuthBindings"
  | "authMaterials"
  | "oauthStates"
>;

const sourceStoreError = createSqlSourceStoreErrorMapper("credentials");

export const createPmCredentialsService = (
  rows: CredentialRows,
): ControlPlaneCredentialsServiceShape =>
  makeControlPlaneCredentialsService({
    listCredentialBindings: (workspaceId) =>
      Effect.gen(function* () {
        const workspaceOption = yield* rows.workspaces.getById(workspaceId).pipe(
          Effect.mapError((error) =>
            sourceStoreError.fromRowStore("credentials.workspaces.get_by_id", error),
          ),
        );

        const workspace = Option.getOrNull(workspaceOption);
        if (workspace === null) {
          return yield* sourceStoreError.fromMessage(
            "credentials.list",
            "Workspace not found",
            `workspace=${workspaceId}`,
          );
        }

        const [bindings, connections] = yield* Effect.all([
          rows.sourceAuthBindings
            .listByWorkspaceScope(workspaceId, workspace.organizationId)
            .pipe(
              Effect.mapError((error) =>
                sourceStoreError.fromRowStore("credentials.bindings.list", error),
              ),
            ),
          rows.authConnections.listByOrganizationId(workspace.organizationId).pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.connections.list", error),
            ),
          ),
        ]);

        const connectionById = new Map(connections.map((connection) => [connection.id, connection]));

        const compatBindings: Array<SourceCredentialBinding> = [];

        for (const binding of bindings) {
          const connection = connectionById.get(binding.connectionId);

          if (!connection) {
            continue;
          }

          compatBindings.push(toCompatSourceCredentialBinding(binding, connection));
        }

        return sortCredentialBindings(compatBindings);
      }),

    upsertCredentialBinding: (input) =>
      Effect.gen(function* () {
        const workspaceOption = yield* rows.workspaces.getById(input.workspaceId).pipe(
          Effect.mapError((error) =>
            sourceStoreError.fromRowStore("credentials.workspaces.get_by_id", error),
          ),
        );

        const workspace = Option.getOrNull(workspaceOption);
        if (workspace === null) {
          return yield* sourceStoreError.fromMessage(
            "credentials.upsert",
            "Workspace not found",
            `workspace=${input.workspaceId}`,
          );
        }

        const organizationId = workspace.organizationId;

        if (input.payload.scopeType === "account" && input.payload.accountId === null) {
          return yield* sourceStoreError.fromMessage(
            "credentials.upsert",
            "Account scope credentials require accountId",
            `workspace=${input.workspaceId}`,
          );
        }

        const sourceId = sourceIdFromSourceKey(input.payload.sourceKey);
        if (!sourceId) {
          return yield* sourceStoreError.fromMessage(
            "credentials.upsert",
            "Credentials require sourceKey in the form 'source:<id>'",
            `workspace=${input.workspaceId}`,
          );
        }

        const now = Date.now();
        const requestedId = input.payload.id;
        const requestedBindingId = requestedId as SourceAuthBinding["id"] | undefined;

        const existingBindingOption = requestedBindingId
          ? yield* rows.sourceAuthBindings.getById(requestedBindingId).pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.binding.get_by_id", error),
            ),
          )
          : Option.none<SourceAuthBinding>();

        const existingBinding = Option.getOrNull(existingBindingOption);
        if (
          existingBinding !== null
          && existingBinding.workspaceId !== input.workspaceId
          && (
            existingBinding.workspaceId !== null
            || existingBinding.organizationId !== organizationId
          )
        ) {
          return yield* sourceStoreError.fromMessage(
            "credentials.upsert",
            "Credential binding is outside workspace scope",
            `workspace=${input.workspaceId} binding=${requestedBindingId}`,
          );
        }

        const scopeWorkspaceId =
          input.payload.scopeType === "workspace" ? input.workspaceId : null;
        const scopeAccountId =
          input.payload.scopeType === "account" ? (input.payload.accountId ?? null) : null;

        const resolvedBindingId = (
          existingBinding?.id
          ?? requestedBindingId
          ?? (`auth_binding_${crypto.randomUUID()}` as SourceAuthBinding["id"])
        ) as SourceAuthBinding["id"];

        const requestedConnectionId = (
          normalizeString(input.payload.credentialId)
          ?? existingBinding?.connectionId
          ?? (`conn_${crypto.randomUUID()}` as AuthConnection["id"])
        ) as AuthConnection["id"];

        const existingConnectionOption = yield* rows.authConnections
          .getById(requestedConnectionId)
          .pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.connection.get_by_id", error),
            ),
          );

        const existingConnection = Option.getOrNull(existingConnectionOption);

        if (existingConnection && existingConnection.organizationId !== organizationId) {
          return yield* sourceStoreError.fromMessage(
            "credentials.upsert",
            "Connection id belongs to another organization",
            `workspace=${input.workspaceId}`,
          );
        }

        const nextConnection: AuthConnection = {
          id: requestedConnectionId,
          organizationId,
          workspaceId: scopeWorkspaceId,
          accountId: scopeAccountId,
          ownerType:
            input.payload.scopeType === "organization"
              ? "organization"
              : input.payload.scopeType === "account"
                ? "account"
                : "workspace",
          strategy: strategyFromProvider(input.payload.provider),
          displayName:
            normalizeString(existingConnection?.displayName)
            ?? sourceKeyFromSourceId(sourceId),
          status: "active",
          statusReason: null,
          lastAuthErrorClass: null,
          metadataJson: existingConnection?.metadataJson ?? null,
          additionalHeadersJson:
            input.payload.additionalHeadersJson !== undefined
              ? input.payload.additionalHeadersJson
              : existingConnection?.additionalHeadersJson ?? null,
          createdByAccountId: existingConnection?.createdByAccountId ?? null,
          createdAt: existingConnection?.createdAt ?? now,
          updatedAt: now,
          lastUsedAt: existingConnection?.lastUsedAt ?? null,
        };

        const nextBinding: SourceAuthBinding = {
          id: resolvedBindingId,
          sourceId: sourceId as SourceAuthBinding["sourceId"],
          connectionId: requestedConnectionId,
          organizationId,
          workspaceId: scopeWorkspaceId,
          accountId: scopeAccountId,
          scopeType: input.payload.scopeType,
          selector: existingBinding?.selector ?? null,
          enabled: true,
          createdAt: existingBinding?.createdAt ?? now,
          updatedAt: now,
        };

        yield* Effect.all([
          rows.authConnections.upsert(nextConnection),
          rows.sourceAuthBindings.upsert(nextBinding),
        ]).pipe(
          Effect.mapError((error) =>
            sourceStoreError.fromRowStore("credentials.upsert_rows", error),
          ),
        );

        if (nextConnection.strategy === "oauth2") {
          const existingOAuthOption = yield* rows.oauthStates
            .getByConnectionId(requestedConnectionId)
            .pipe(
              Effect.mapError((error) =>
                sourceStoreError.fromRowStore("credentials.oauth_states.get_by_connection", error),
              ),
            );
          const existingOAuth = Option.getOrNull(existingOAuthOption);

          const refreshConfig = buildOAuthRefreshConfigFromPayload(
            input.payload,
            parseOAuthRefreshConfig(existingOAuth?.refreshConfigJson ?? null),
          );

          const oauthState: OAuthState = {
            id:
              existingOAuth?.id
              ?? (`oauth_state_${crypto.randomUUID()}` as OAuthState["id"]),
            connectionId: requestedConnectionId,
            accessTokenCiphertext: input.payload.secretRef,
            refreshTokenCiphertext:
              input.payload.oauthRefreshToken !== undefined
                ? normalizeString(input.payload.oauthRefreshToken)
                : existingOAuth?.refreshTokenCiphertext ?? null,
            keyVersion: existingOAuth?.keyVersion ?? "local",
            expiresAt:
              input.payload.oauthExpiresAt !== undefined
                ? input.payload.oauthExpiresAt
                : existingOAuth?.expiresAt ?? null,
            scope:
              input.payload.oauthScope !== undefined
                ? input.payload.oauthScope
                : existingOAuth?.scope ?? null,
            tokenType: existingOAuth?.tokenType ?? "Bearer",
            issuer:
              input.payload.oauthIssuer !== undefined
                ? input.payload.oauthIssuer
                : existingOAuth?.issuer ?? null,
            refreshConfigJson: encodeOAuthRefreshConfig(refreshConfig),
            tokenVersion: (existingOAuth?.tokenVersion ?? 0) + 1,
            leaseHolder: null,
            leaseExpiresAt: null,
            leaseFence: existingOAuth?.leaseFence ?? 0,
            lastRefreshAt: existingOAuth?.lastRefreshAt ?? null,
            lastRefreshErrorClass: null,
            lastRefreshError: null,
            reauthRequiredAt: null,
            createdAt: existingOAuth?.createdAt ?? now,
            updatedAt: now,
          };

          yield* Effect.all([
            rows.oauthStates.upsert(oauthState),
            rows.authMaterials.removeByConnectionId(requestedConnectionId),
          ]).pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.upsert_oauth", error),
            ),
          );
        } else {
          const existingMaterialOption = yield* rows.authMaterials
            .getByConnectionId(requestedConnectionId)
            .pipe(
              Effect.mapError((error) =>
                sourceStoreError.fromRowStore("credentials.materials.get_by_connection", error),
              ),
            );
          const existingMaterial = Option.getOrNull(existingMaterialOption);

          const material: AuthMaterial = {
            id:
              existingMaterial?.id
              ?? (`auth_material_${crypto.randomUUID()}` as AuthMaterial["id"]),
            connectionId: requestedConnectionId,
            ciphertext: input.payload.secretRef,
            keyVersion: existingMaterial?.keyVersion ?? "local",
            createdAt: existingMaterial?.createdAt ?? now,
            updatedAt: now,
          };

          yield* Effect.all([
            rows.authMaterials.upsert(material),
            rows.oauthStates.removeByConnectionId(requestedConnectionId),
          ]).pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.upsert_secret", error),
            ),
          );
        }

        return toCompatSourceCredentialBinding(nextBinding, nextConnection);
      }),

    removeCredentialBinding: (input) =>
      Effect.gen(function* () {
        const workspaceOption = yield* rows.workspaces.getById(input.workspaceId).pipe(
          Effect.mapError((error) =>
            sourceStoreError.fromRowStore("credentials.workspaces.get_by_id", error),
          ),
        );

        const workspace = Option.getOrNull(workspaceOption);
        if (workspace === null) {
          return {
            removed: false,
          };
        }

        const bindingOption = yield* rows.sourceAuthBindings
          .getById(input.credentialBindingId)
          .pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.binding.get_by_id", error),
            ),
          );

        const binding = Option.getOrNull(bindingOption);
        if (
          binding === null
          || (
            binding.workspaceId !== input.workspaceId
            && (binding.workspaceId !== null || binding.organizationId !== workspace.organizationId)
          )
        ) {
          return {
            removed: false,
          };
        }

        const removed = yield* rows.sourceAuthBindings
          .removeById(binding.id)
          .pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.remove_binding", error),
            ),
          );

        if (!removed) {
          return {
            removed: false,
          };
        }

        const remainingBindings = yield* rows.sourceAuthBindings
          .listByConnectionId(binding.connectionId)
          .pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.bindings.list_by_connection", error),
            ),
          );

        const hasRemainingBindings = remainingBindings.some((candidate) => candidate.id !== binding.id);

        if (!hasRemainingBindings) {
          yield* Effect.all([
            rows.authConnections.removeById(binding.connectionId),
            rows.authMaterials.removeByConnectionId(binding.connectionId),
            rows.oauthStates.removeByConnectionId(binding.connectionId),
          ]).pipe(
            Effect.mapError((error) =>
              sourceStoreError.fromRowStore("credentials.remove_connection_data", error),
            ),
          );
        }

        return {
          removed: true,
        };
      }),
  });
