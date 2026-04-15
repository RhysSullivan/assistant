export {
  makeConfiguredWorkOSVaultClient,
  makeWorkOSVaultClient,
  WorkOSVaultClientError,
  WorkOSVaultClientInstantiationError,
  type WorkOSVaultClient,
  type WorkOSVaultCredentials,
  type WorkOSVaultObject,
  type WorkOSVaultObjectMetadata,
  type WorkOSVaultSdk,
} from "./client";
export {
  workosVaultPlugin,
  type WorkOSVaultExtension,
  type WorkOSVaultPluginOptions,
} from "./plugin";
export {
  WORKOS_VAULT_PROVIDER_KEY,
  makeWorkOSVaultSecretProvider,
  makeWorkosVaultStore,
  workosVaultSchema,
  type WorkOSVaultSecretProviderOptions,
  type WorkosVaultSchema,
  type WorkosVaultStore,
} from "./secret-store";
