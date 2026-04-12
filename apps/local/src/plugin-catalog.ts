import type { SecretProviderPlugin } from "@executor/react/plugins/secret-provider-plugin";
import { firstPartySourcePlugins } from "@executor/host-plugins/ui";
import { onePasswordSecretProviderPlugin } from "@executor/plugin-onepassword/react";

export const localSourcePlugins = firstPartySourcePlugins;

export const localSecretProviderPlugins = [
  onePasswordSecretProviderPlugin,
] as const satisfies readonly SecretProviderPlugin[];
