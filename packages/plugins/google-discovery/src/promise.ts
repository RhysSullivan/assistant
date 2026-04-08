import { googleDiscoveryPlugin as googleDiscoveryPluginEffect } from "./sdk/plugin";

export type {
  GoogleDiscoveryAddSourceInput,
  GoogleDiscoveryProbeResult,
  GoogleDiscoveryOAuthStartInput,
  GoogleDiscoveryOAuthStartResponse,
  GoogleDiscoveryOAuthCompleteInput,
  GoogleDiscoveryOAuthAuthResult,
} from "./sdk/plugin";

export const googleDiscoveryPlugin = (options?: {}) =>
  googleDiscoveryPluginEffect(options);
