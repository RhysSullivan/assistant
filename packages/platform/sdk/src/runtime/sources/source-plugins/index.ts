import {
  registerExecutorSdkPlugins,
  type ExecutorSdkPlugin,
} from "../../../plugins";

import {
  InternalSourceSdkPlugin,
} from "./internal";

let configuredExternalSourcePlugins: readonly ExecutorSdkPlugin[] = [];
let registry = registerExecutorSdkPlugins([
  InternalSourceSdkPlugin,
]);

const refreshRegistry = () => {
  registry = registerExecutorSdkPlugins([
    ...configuredExternalSourcePlugins,
    InternalSourceSdkPlugin,
  ]);
};

export const configureExecutorSourcePlugins = (
  plugins: readonly ExecutorSdkPlugin[],
): void => {
  configuredExternalSourcePlugins = plugins;
  refreshRegistry();
};

export const registeredSourcePlugins = () => registry.sourcePlugins;
export const registeredSourceConnectors = () => registry.sourceConnectors;

export const getSourcePlugin = (kind: string) => registry.getSourcePlugin(kind);
export const getSourcePluginForSource = (
  source: Parameters<typeof registry.getSourcePluginForSource>[0],
) => registry.getSourcePluginForSource(source);
export const sourcePluginCatalogKind = (kind: string) =>
  registry.sourcePluginCatalogKind(kind);
export const isInternalSourcePluginKind = (kind: string) =>
  registry.isInternalSourcePluginKind(kind);

export const hasRegisteredExternalSourcePlugins = () =>
  configuredExternalSourcePlugins.length > 0;
