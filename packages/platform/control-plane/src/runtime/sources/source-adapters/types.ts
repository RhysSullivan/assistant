import type {
  CredentialSlot,
  OAuth2ClientAuthenticationMethod,
  SourceOauthClientInput,
  Source,
  SourceBinding,
  SourceImportAuthPolicy,
  SourceTransport,
  StoredSourceRecord,
  StringMap,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ResolvedSourceAuthMaterial } from "../../auth/source-auth-material";
import type { ResolveSecretMaterial } from "../../local/secret-material-providers";
import type { SourceCatalogSyncResult } from "../catalog-sync-result";

export type SourceAdapterFamily = "http_api" | "mcp" | "internal";
export type SourceAdapterInputSchema = Schema.Schema<any, any, never>;
export type SourceBindingState = {
  transport: SourceTransport | null;
  queryParams: StringMap | null;
  headers: StringMap | null;
  specUrl: string | null;
  defaultHeaders: StringMap | null;
};

export type StoredSourceBindingConfig = Pick<SourceBinding, "version" | "payload">;

export type SourceAdapterSyncInput = {
  source: Source;
  resolveSecretMaterial: ResolveSecretMaterial;
  resolveAuthMaterialForSlot: (slot: CredentialSlot) => Effect.Effect<
    ResolvedSourceAuthMaterial,
    Error,
    never
  >;
};

export type SourceAdapterOauth2SetupConfig = {
  providerKey: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: readonly string[];
  headerName: string;
  prefix: string;
  clientAuthentication: OAuth2ClientAuthenticationMethod;
  authorizationParams?: Readonly<Record<string, string>>;
};

export type SourceAdapter = {
  key: string;
  displayName: string;
  family: SourceAdapterFamily;
  bindingConfigVersion: number;
  providerKey: string;
  defaultImportAuthPolicy: SourceImportAuthPolicy;
  connectPayloadSchema: SourceAdapterInputSchema | null;
  executorAddInputSchema: SourceAdapterInputSchema | null;
  executorAddHelpText: readonly string[] | null;
  executorAddInputSignatureWidth: number | null;
  serializeBindingConfig: (source: Source) => string;
  deserializeBindingConfig: (
    input: Pick<StoredSourceRecord, "id" | "bindingConfigJson">,
  ) => Effect.Effect<StoredSourceBindingConfig, Error, never>;
  bindingStateFromSource: (source: Source) => Effect.Effect<SourceBindingState, Error, never>;
  sourceConfigFromSource: (source: Source) => Record<string, unknown>;
  validateSource: (source: Source) => Effect.Effect<Source, Error, never>;
  shouldAutoProbe: (source: Source) => boolean;
  syncCatalog: (
    input: SourceAdapterSyncInput,
  ) => Effect.Effect<SourceCatalogSyncResult, Error, never>;
  getOauth2SetupConfig?: (input: {
    source: Source;
    slot: CredentialSlot;
  }) => Effect.Effect<SourceAdapterOauth2SetupConfig | null, Error, never>;
  normalizeOauthClientInput?: (
    input: SourceOauthClientInput,
  ) => Effect.Effect<SourceOauthClientInput, Error, never>;
};
