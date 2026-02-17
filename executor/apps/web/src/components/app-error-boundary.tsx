"use client";

import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { clearAnonymousAuth } from "@/lib/anonymous-auth";
import { clearSessionStorage } from "@/lib/session-storage";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  componentErrorInfo: ErrorInfo | null;
};

const CLIENT_STORAGE_PREFIX = "executor-";

function clearClientStorage() {
  if (typeof window === "undefined") {
    return;
  }

  clearSessionStorage();
  clearAnonymousAuth({ clearAccount: true });

  const clearPrefixedStorage = (storage: Storage) => {
    const keysToDelete: string[] = [];

    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key && key.startsWith(CLIENT_STORAGE_PREFIX)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      storage.removeItem(key);
    }
  };

  clearPrefixedStorage(window.localStorage);
  clearPrefixedStorage(window.sessionStorage);
}

function buildErrorDetails(error: Error | null, errorInfo: ErrorInfo | null) {
  const lines = [error?.message ?? "Unknown error"];

  if (error?.stack) {
    lines.push("", "Stack", error.stack);
  }

  if (errorInfo?.componentStack) {
    lines.push("", "Component stack", errorInfo.componentStack);
  }

  return lines.join("\n");
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    componentErrorInfo: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error, componentErrorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, componentErrorInfo: errorInfo });
  }

  handleRecover = () => {
    try {
      clearClientStorage();
    } finally {
      window.location.assign("/sign-out");
    }
  };

  render() {
    const { error, componentErrorInfo } = this.state;

    if (!error) {
      return this.props.children;
    }

    const details = buildErrorDetails(error, componentErrorInfo);

    return (
      <div className="min-h-screen grid place-items-center bg-background px-4 py-8">
        <div className="w-full max-w-2xl border border-border rounded-lg bg-card text-foreground p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div className="space-y-1 min-w-0">
              <h2 className="text-lg font-semibold">Something went wrong</h2>
              <p className="text-sm text-muted-foreground">The app hit an unexpected error. Use refresh to clear cached state and sign out.</p>
            </div>
          </div>

          <details className="rounded border border-border/60 bg-background/60 p-3">
            <summary className="cursor-pointer text-sm font-medium">Show error details</summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-black/80 text-[11px] leading-tight text-white/90 p-3 whitespace-pre-wrap break-all">
              {details}
            </pre>
          </details>

          <Button className="w-full md:w-auto" onClick={this.handleRecover}>
            <RotateCcw className="h-4 w-4" />
            Refresh and recover
          </Button>
        </div>
      </div>
    );
  }
}
