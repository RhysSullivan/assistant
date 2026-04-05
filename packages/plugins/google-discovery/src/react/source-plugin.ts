import { lazy } from "react";
import type { SourcePlugin } from "@executor/react";
import { googleDiscoveryPresets } from "../sdk/presets";

export const googleDiscoverySourcePlugin: SourcePlugin = {
  key: "googleDiscovery",
  label: "Google Discovery",
  add: lazy(() => import("./AddGoogleDiscoverySource")),
  edit: lazy(() => import("./EditGoogleDiscoverySource")),
  summary: lazy(() => import("./GoogleDiscoverySourceSummary")),
  presets: googleDiscoveryPresets,
};
