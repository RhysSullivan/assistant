import { createFileRoute } from "@tanstack/react-router";
import { SecretsPage } from "@executor/react/pages/secrets";

export const Route = createFileRoute("/secrets")({
  component: SecretsPage,
});
