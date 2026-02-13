"use client";

import { useState } from "react";
import { Link } from "react-router";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/lib/session-context";
import { anonymousDemoEnabled, workosEnabled } from "@/lib/auth-capabilities";

export function NoOrganizationModal({ enabled }: { enabled: boolean }) {
  const {
    loading,
    organizations,
    organizationsLoading,
    context,
    isSignedInToWorkos,
    createAnonymousOrganization,
    creatingAnonymousOrganization,
  } = useSession();
  const [error, setError] = useState<string | null>(null);

  const shouldShow = enabled
    && !loading
    && !organizationsLoading
    && !context
    && !isSignedInToWorkos
    && organizations.length === 0;

  const handleCreateAnonymousOrganization = async () => {
    setError(null);
    try {
      await createAnonymousOrganization();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create anonymous organization";
      setError(message);
    }
  };

  return (
    <Dialog open={shouldShow}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Choose how to continue</DialogTitle>
          <DialogDescription>
            Sign in to access your organizations, or create an anonymous organization with a default workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {workosEnabled ? (
            <Button asChild className="w-full" disabled={creatingAnonymousOrganization}>
              <Link to="/sign-in" reloadDocument className="gap-2">
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
            </Button>
          ) : null}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleCreateAnonymousOrganization}
            disabled={creatingAnonymousOrganization || !anonymousDemoEnabled}
          >
            {creatingAnonymousOrganization ? "Creating anonymous organization..." : "Create anonymous organization"}
          </Button>
          {!anonymousDemoEnabled ? (
            <p className="text-xs text-muted-foreground">Anonymous organization creation is disabled.</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
