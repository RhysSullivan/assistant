"use client";

import { createContext, useContext, useMemo } from "react";
import { ConvexProviderWithAuth } from "convex/react";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth as useWorkosAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { workosEnabled } from "@/lib/auth-capabilities";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("CONVEX_URL is not set. Add it to the root .env file.");
}
const convexClient = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});

/** Exposes whether the WorkOS auth token is still being resolved. */
const WorkosAuthContext = createContext({
  loading: false,
  authenticated: false,
});

export function useWorkosAuthState() {
  return useContext(WorkosAuthContext);
}

function useConvexAuthFromWorkos() {
  const { loading: authLoading, user } = useWorkosAuth();
  const { loading: tokenLoading, getAccessToken } = useAccessToken();
  const isAuthenticated = Boolean(user);
  const isLoading = authLoading || (isAuthenticated && tokenLoading);

  const fetchAccessToken = useMemo(
    () => async () => {
      try {
        const token = await getAccessToken();
        return token ?? null;
      } catch {
        return null;
      }
    },
    [getAccessToken],
  );

  return useMemo(
    () => ({
      isLoading,
      isAuthenticated,
      fetchAccessToken,
    }),
    [isLoading, isAuthenticated, fetchAccessToken],
  );
}

function ConvexWithWorkos({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useWorkosAuth();
  const { loading: tokenLoading } = useAccessToken();
  const authenticated = Boolean(user);
  const loading = authLoading || (authenticated && tokenLoading);

  return (
    <WorkosAuthContext.Provider value={{ loading, authenticated }}>
      <ConvexProviderWithAuth client={convexClient} useAuth={useConvexAuthFromWorkos}>
        {children}
      </ConvexProviderWithAuth>
    </WorkosAuthContext.Provider>
  );
}

export function AppConvexProvider({ children }: { children: ReactNode }) {
  if (workosEnabled) {
    return (
      <AuthKitProvider>
        <ConvexWithWorkos>{children}</ConvexWithWorkos>
      </AuthKitProvider>
    );
  }

  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
