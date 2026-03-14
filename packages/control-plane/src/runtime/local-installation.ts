import { createHash } from "node:crypto";

import type { SqlControlPlaneRows } from "#persistence";
import {
  AccountIdSchema,
  InstallationIdSchema,
  OrganizationIdSchema,
  WorkspaceIdSchema,
  type LocalInstallation,
} from "#schema";
import * as Effect from "effect/Effect";

import type { ResolvedLocalWorkspaceContext } from "./local-config";

const LOCAL_ACCOUNT_ID = AccountIdSchema.make("acc_local_default");
const LOCAL_ORGANIZATION_ID = OrganizationIdSchema.make("org_local_personal");

const stableHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

const normalizeSlashPath = (value: string): string =>
  value.replaceAll("\\", "/");

const deriveWorkspaceId = (context: ResolvedLocalWorkspaceContext) =>
  WorkspaceIdSchema.make(
    `ws_local_${stableHash(normalizeSlashPath(context.workspaceRoot))}`,
  );

export const deriveLocalInstallation = (
  context: ResolvedLocalWorkspaceContext,
): LocalInstallation => ({
  id: InstallationIdSchema.make(context.installationId),
  accountId: LOCAL_ACCOUNT_ID,
  organizationId: LOCAL_ORGANIZATION_ID,
  workspaceId: deriveWorkspaceId(context),
  // Derived local identity is deterministic; timestamps are not authoritative state.
  createdAt: 0,
  updatedAt: 0,
});

export const loadLocalInstallation = (
  _rows: SqlControlPlaneRows,
  context: ResolvedLocalWorkspaceContext,
): Effect.Effect<LocalInstallation, never> =>
  Effect.succeed(deriveLocalInstallation(context));

export const provisionLocalInstallation = (input: {
  rows: SqlControlPlaneRows;
  context: ResolvedLocalWorkspaceContext;
}): Effect.Effect<LocalInstallation, never> =>
  loadLocalInstallation(input.rows, input.context);

export const getOrProvisionLocalInstallation = (input: {
  rows: SqlControlPlaneRows;
  context: ResolvedLocalWorkspaceContext;
}): Effect.Effect<LocalInstallation, never> =>
  loadLocalInstallation(input.rows, input.context);
