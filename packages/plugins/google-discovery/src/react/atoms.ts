import { GoogleDiscoveryClient } from "./client";

export const probeGoogleDiscovery = GoogleDiscoveryClient.mutation(
  "googleDiscovery",
  "probeDiscovery",
);
export const addGoogleDiscoverySource = GoogleDiscoveryClient.mutation(
  "googleDiscovery",
  "addSource",
);
export const startGoogleDiscoveryOAuth = GoogleDiscoveryClient.mutation(
  "googleDiscovery",
  "startOAuth",
);
export const completeGoogleDiscoveryOAuth = GoogleDiscoveryClient.mutation(
  "googleDiscovery",
  "completeOAuth",
);
