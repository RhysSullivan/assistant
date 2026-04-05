import { lazy } from "react";
import type { SecretProviderPlugin } from "@executor/react";

export const onePasswordSecretProviderPlugin: SecretProviderPlugin = {
  key: "onepassword",
  label: "1Password",
  settings: lazy(() => import("./OnePasswordSettings")),
};
