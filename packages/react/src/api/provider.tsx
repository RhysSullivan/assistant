import { RegistryProvider } from "@effect-atom/atom-react";
import * as React from "react";
import { PluginCatalogProvider } from "../plugins/plugin-catalog";
import type { SecretProviderPlugin } from "../plugins/secret-provider-plugin";
import type { SourcePlugin } from "../plugins/source-plugin";
import { ScopeProvider } from "./scope-context";

export const ExecutorProvider = (
  props: React.PropsWithChildren<{
    readonly sourcePlugins?: readonly SourcePlugin[];
    readonly secretProviderPlugins?: readonly SecretProviderPlugin[];
  }>,
) => (
  <RegistryProvider>
    <ScopeProvider>
      <PluginCatalogProvider
        sourcePlugins={props.sourcePlugins}
        secretProviderPlugins={props.secretProviderPlugins}
      >
        {props.children}
      </PluginCatalogProvider>
    </ScopeProvider>
  </RegistryProvider>
);
