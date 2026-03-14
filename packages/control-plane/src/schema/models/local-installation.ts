import * as Schema from "effect/Schema";

import { TimestampMsSchema } from "../common";
import {
  AccountIdSchema,
  InstallationIdSchema,
  OrganizationIdSchema,
  WorkspaceIdSchema,
} from "../ids";

export const LocalInstallationSchema = Schema.Struct({
  id: InstallationIdSchema,
  accountId: AccountIdSchema,
  organizationId: OrganizationIdSchema,
  workspaceId: WorkspaceIdSchema,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const LocalInstallationInsertSchema = LocalInstallationSchema;
export const LocalInstallationUpdateSchema = Schema.partial(LocalInstallationSchema);

export type LocalInstallation = typeof LocalInstallationSchema.Type;
