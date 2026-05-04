import { createFileRoute } from "@tanstack/react-router";
import { SecretsPage } from "@executor-js/react/pages/secrets";

export const Route = createFileRoute("/$org/$workspace/secrets")({
  component: () => (
    <SecretsPage
      addSecretDescription="Store a credential or API key for this workspace."
      showProviderInfo={false}
      storageOptions={[{ value: "workos-vault", label: "WorkOS Vault" }]}
    />
  ),
});
