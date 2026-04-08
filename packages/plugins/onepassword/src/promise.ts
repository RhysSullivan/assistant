/**
 * Public types for @executor-js/plugin-onepassword.
 *
 * The plugin factory requires an Effect-based ScopedKv and must be
 * imported from '@executor-js/plugin-onepassword/core'.
 */
export type {
  OnePasswordExtension,
  OnePasswordPluginOptions,
} from "./sdk/plugin";
export { OnePasswordConfig, ConnectionStatus, Vault, OnePasswordAuth, DesktopAppAuth, ServiceAccountAuth } from "./sdk/types";
export { OnePasswordError } from "./sdk/errors";
