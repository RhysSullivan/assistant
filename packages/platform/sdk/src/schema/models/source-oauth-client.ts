import {
  Schema,
} from "effect";
export {
  SourceOauthClientInputSchema,
  ScopedSourceOauthClientRedirectModeSchema,
} from "@executor/source-core";
import {
  SourceOauthClientInputSchema,
  ScopedSourceOauthClientRedirectModeSchema,
} from "@executor/source-core";

import {
  TimestampMsSchema,
} from "../common";
import {
  SourceIdSchema,
  ScopeIdSchema,
  ScopedSourceOauthClientIdSchema,
} from "../ids";

export const ScopedSourceOauthClientMetadataSchema = Schema.Struct({
  redirectMode: Schema.optional(ScopedSourceOauthClientRedirectModeSchema),
});

export const ScopedSourceOauthClientMetadataJsonSchema = Schema.parseJson(
  ScopedSourceOauthClientMetadataSchema,
);

export const ScopedSourceOauthClientSchema = Schema.Struct({
  id: ScopedSourceOauthClientIdSchema,
  scopeId: ScopeIdSchema,
  sourceId: SourceIdSchema,
  providerKey: Schema.String,
  clientId: Schema.String,
  clientSecretProviderId: Schema.NullOr(Schema.String),
  clientSecretHandle: Schema.NullOr(Schema.String),
  clientMetadataJson: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export type ScopedSourceOauthClient = typeof ScopedSourceOauthClientSchema.Type;
export type ScopedSourceOauthClientRedirectMode =
  typeof ScopedSourceOauthClientRedirectModeSchema.Type;
export type ScopedSourceOauthClientMetadata =
  typeof ScopedSourceOauthClientMetadataSchema.Type;
export type SourceOauthClientInput = typeof SourceOauthClientInputSchema.Type;
