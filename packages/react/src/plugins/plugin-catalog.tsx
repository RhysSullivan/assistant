import * as React from "react";

import type { SecretProviderPlugin } from "./secret-provider-plugin";
import type { SourcePlugin } from "./source-plugin";

type PluginCatalogValue = {
  readonly sourcePlugins: readonly SourcePlugin[];
  readonly secretProviderPlugins: readonly SecretProviderPlugin[];
};

const PluginCatalogContext = React.createContext<PluginCatalogValue>({
  sourcePlugins: [],
  secretProviderPlugins: [],
});

export function PluginCatalogProvider(
  props: React.PropsWithChildren<{
    readonly sourcePlugins?: readonly SourcePlugin[];
    readonly secretProviderPlugins?: readonly SecretProviderPlugin[];
  }>,
) {
  const value = React.useMemo<PluginCatalogValue>(
    () => ({
      sourcePlugins: props.sourcePlugins ?? [],
      secretProviderPlugins: props.secretProviderPlugins ?? [],
    }),
    [props.secretProviderPlugins, props.sourcePlugins],
  );

  return <PluginCatalogContext.Provider value={value}>{props.children}</PluginCatalogContext.Provider>;
}

export const useSourcePlugins = () => React.useContext(PluginCatalogContext).sourcePlugins;

export const useSecretProviderPlugins = () =>
  React.useContext(PluginCatalogContext).secretProviderPlugins;
