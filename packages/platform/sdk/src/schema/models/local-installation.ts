import * as Schema from "effect/Schema";

import {
  ScopeIdSchema,
} from "../ids";

export const LocalInstallationSchema = Schema.Struct({
  scopeId: ScopeIdSchema,
  actorScopeId: ScopeIdSchema,
});

export const LocalInstallationInsertSchema = LocalInstallationSchema;
export const LocalInstallationUpdateSchema = Schema.partial(LocalInstallationSchema);

export type LocalInstallation = typeof LocalInstallationSchema.Type;
