export {
  makeConfiguredWorkOSVaultClient,
  makeWorkOSVaultClient,
  WorkOSVaultClientInstantiationError,
  type WorkOSVaultClient,
  type WorkOSVaultCredentials,
} from "./client";
export { workosVaultPlugin, type WorkOSVaultExtension } from "./plugin";
export {
  WORKOS_VAULT_PROVIDER_KEY,
  makeConfiguredWorkOSVaultSecretStore,
  makeWorkOSVaultSecretStore,
  type ConfiguredWorkOSVaultSecretStoreOptions,
  type WorkOSVaultSecretStoreOptions,
} from "./secret-store";
