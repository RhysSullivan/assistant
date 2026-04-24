import { lazy } from "react";
import type { SecretProviderPlugin } from "@executor/react/plugins/secret-provider-plugin";

export const workosVaultSecretProviderPlugin: SecretProviderPlugin = {
  key: "workosVault",
  label: "WorkOS Vault",
  settings: lazy(() => import("./WorkOSVaultSettings")),
};
