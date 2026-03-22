import {
  Schema,
} from "effect";

export const ScopeIdSchema = Schema.String.pipe(Schema.brand("ScopeId"));
export const SourceIdSchema = Schema.String.pipe(Schema.brand("SourceId"));
export const SourceCatalogIdSchema = Schema.String.pipe(Schema.brand("SourceCatalogId"));
export const SourceCatalogRevisionIdSchema = Schema.String.pipe(
  Schema.brand("SourceCatalogRevisionId"),
);
export const SourceAuthSessionIdSchema = Schema.String.pipe(
  Schema.brand("SourceAuthSessionId"),
);
export const AuthArtifactIdSchema = Schema.String.pipe(
  Schema.brand("AuthArtifactId"),
);
export const AuthLeaseIdSchema = Schema.String.pipe(
  Schema.brand("AuthLeaseId"),
);
export const CredentialIdSchema = AuthArtifactIdSchema;
export const ScopedSourceOauthClientIdSchema = Schema.String.pipe(
  Schema.brand("ScopedSourceOauthClientId"),
);
export const ScopeOauthClientIdSchema = Schema.String.pipe(
  Schema.brand("ScopeOauthClientId"),
);
export const ProviderAuthGrantIdSchema = Schema.String.pipe(
  Schema.brand("ProviderAuthGrantId"),
);
export const SecretMaterialIdSchema = Schema.String.pipe(
  Schema.brand("SecretMaterialId"),
);
export const PolicyIdSchema = Schema.String.pipe(Schema.brand("PolicyId"));
export const ExecutionIdSchema = Schema.String.pipe(Schema.brand("ExecutionId"));
export const ExecutionInteractionIdSchema = Schema.String.pipe(
  Schema.brand("ExecutionInteractionId"),
);
export const ExecutionStepIdSchema = Schema.String.pipe(
  Schema.brand("ExecutionStepId"),
);

export type ScopeId = typeof ScopeIdSchema.Type;
export type SourceId = typeof SourceIdSchema.Type;
export type SourceCatalogId = typeof SourceCatalogIdSchema.Type;
export type SourceCatalogRevisionId = typeof SourceCatalogRevisionIdSchema.Type;
export type SourceAuthSessionId = typeof SourceAuthSessionIdSchema.Type;
export type AuthArtifactId = typeof AuthArtifactIdSchema.Type;
export type AuthLeaseId = typeof AuthLeaseIdSchema.Type;
export type CredentialId = typeof CredentialIdSchema.Type;
export type ScopedSourceOauthClientId = typeof ScopedSourceOauthClientIdSchema.Type;
export type ScopeOauthClientId = typeof ScopeOauthClientIdSchema.Type;
export type ProviderAuthGrantId = typeof ProviderAuthGrantIdSchema.Type;
export type SecretMaterialId = typeof SecretMaterialIdSchema.Type;
export type PolicyId = typeof PolicyIdSchema.Type;
export type ExecutionId = typeof ExecutionIdSchema.Type;
export type ExecutionInteractionId = typeof ExecutionInteractionIdSchema.Type;
export type ExecutionStepId = typeof ExecutionStepIdSchema.Type;
