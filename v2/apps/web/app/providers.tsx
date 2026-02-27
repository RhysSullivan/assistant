"use client";

import { RegistryProvider } from "@effect-atom/atom-react";
import type { ReactNode } from "react";

type ProvidersProps = {
  children: ReactNode;
};

export const Providers = ({ children }: ProvidersProps) => (
  <RegistryProvider>{children}</RegistryProvider>
);
