import type { SecretProviderPlugin } from "@executor/react/plugins/secret-provider-plugin";
import { firstPartySourcePlugins } from "@executor/host-plugins/ui";

export const cloudSourcePlugins = firstPartySourcePlugins;

export const cloudSecretProviderPlugins = [] as const satisfies readonly SecretProviderPlugin[];
