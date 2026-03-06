import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/effect-schema";

import { localInstallationsTable } from "../../persistence/schema";
import { TimestampMsSchema } from "../common";
import {
  AccountIdSchema,
  InstallationIdSchema,
  OrganizationIdSchema,
  WorkspaceIdSchema,
} from "../ids";

const localInstallationSchemaOverrides = {
  id: InstallationIdSchema,
  accountId: AccountIdSchema,
  organizationId: OrganizationIdSchema,
  workspaceId: WorkspaceIdSchema,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

export const LocalInstallationSchema = createSelectSchema(
  localInstallationsTable,
  localInstallationSchemaOverrides,
);

export const LocalInstallationInsertSchema = createInsertSchema(
  localInstallationsTable,
  localInstallationSchemaOverrides,
);

export const LocalInstallationUpdateSchema = createUpdateSchema(
  localInstallationsTable,
  localInstallationSchemaOverrides,
);

export type LocalInstallation = typeof LocalInstallationSchema.Type;
