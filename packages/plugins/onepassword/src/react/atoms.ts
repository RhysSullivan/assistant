import { ScopeId } from "@executor/sdk";
import { OnePasswordClient } from "./client";

// ---------------------------------------------------------------------------
// Stable default scope
// ---------------------------------------------------------------------------

const DEFAULT_SCOPE = ScopeId.make("default");

// ---------------------------------------------------------------------------
// Query atoms — stable references for default scope
// ---------------------------------------------------------------------------

export const onepasswordConfigAtom = (scopeId: ScopeId = DEFAULT_SCOPE) =>
  OnePasswordClient.query("onepassword", "getConfig", {
    path: { scopeId },
    timeToLive: "30 seconds",
  });

export const onepasswordStatusAtom = (scopeId: ScopeId = DEFAULT_SCOPE) =>
  OnePasswordClient.query("onepassword", "status", {
    path: { scopeId },
    timeToLive: "15 seconds",
  });

// ---------------------------------------------------------------------------
// Query atoms — vaults
// ---------------------------------------------------------------------------

export const onepasswordVaultsAtom = (
  authKind: "desktop-app" | "service-account",
  account: string,
  scopeId: ScopeId = DEFAULT_SCOPE,
) =>
  OnePasswordClient.query("onepassword", "listVaults", {
    path: { scopeId },
    urlParams: { authKind, account },
    timeToLive: "30 seconds",
  });

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const configureOnePassword = OnePasswordClient.mutation(
  "onepassword",
  "configure",
);

export const removeOnePasswordConfig = OnePasswordClient.mutation(
  "onepassword",
  "removeConfig",
);
