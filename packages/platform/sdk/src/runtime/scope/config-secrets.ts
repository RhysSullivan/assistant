export const CONFIG_SECRET_PROVIDER_PREFIX = "config:";

export const toConfigSecretProviderId = (providerAlias: string): string =>
  `${CONFIG_SECRET_PROVIDER_PREFIX}${providerAlias}`;

export const fromConfigSecretProviderId = (providerId: string): string | null =>
  providerId.startsWith(CONFIG_SECRET_PROVIDER_PREFIX)
    ? providerId.slice(CONFIG_SECRET_PROVIDER_PREFIX.length)
    : null;
