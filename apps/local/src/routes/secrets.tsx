import { createFileRoute } from "@tanstack/react-router";
import { SecretsPage } from "@executor-js/react/pages/secrets";
import { onePasswordSecretProviderPlugin } from "@executor-js/plugin-onepassword/react";

const secretProviderPlugins = [onePasswordSecretProviderPlugin];

export const Route = createFileRoute("/secrets")({
  component: () => <SecretsPage secretProviderPlugins={secretProviderPlugins} />,
});
