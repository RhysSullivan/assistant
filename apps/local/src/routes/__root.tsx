import React from "react";
import { createRootRoute } from "@tanstack/react-router";
import { ExecutorProvider } from "@executor/react/api/provider";
import { Shell } from "../web/shell";
import { localSecretProviderPlugins, localSourcePlugins } from "../plugin-catalog";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ExecutorProvider
      sourcePlugins={localSourcePlugins}
      secretProviderPlugins={localSecretProviderPlugins}
    >
      <Shell />
    </ExecutorProvider>
  );
}
