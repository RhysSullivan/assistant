import { RegistryProvider } from "@effect-atom/atom-react";
import * as React from "react";
import { ScopeProvider } from "./scope-context";

export const ExecutorProvider = (props: React.PropsWithChildren) => (
  <RegistryProvider>
    <ScopeProvider>{props.children}</ScopeProvider>
  </RegistryProvider>
);
