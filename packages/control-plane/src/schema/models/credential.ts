import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { credentialsTable } from "../../persistence/schema";
import { TimestampMsSchema } from "../common";
import {
  AccountIdSchema,
  CredentialIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
} from "../ids";

export const CredentialAuthKindSchema = Schema.Literal("bearer", "oauth2");
export const CredentialSlotSchema = Schema.Literal("runtime", "import");

const credentialSchemaOverrides = {
  id: CredentialIdSchema,
  workspaceId: WorkspaceIdSchema,
  sourceId: SourceIdSchema,
  actorAccountId: Schema.NullOr(AccountIdSchema),
  slot: CredentialSlotSchema,
  authKind: CredentialAuthKindSchema,
  authHeaderName: Schema.String,
  authPrefix: Schema.String,
  tokenProviderId: Schema.String,
  tokenHandle: Schema.String,
  refreshTokenProviderId: Schema.NullOr(Schema.String),
  refreshTokenHandle: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

export const CredentialSchema = createSelectSchema(
  credentialsTable,
  credentialSchemaOverrides,
);

export type CredentialAuthKind = typeof CredentialAuthKindSchema.Type;
export type CredentialSlot = typeof CredentialSlotSchema.Type;
export type Credential = typeof CredentialSchema.Type;
