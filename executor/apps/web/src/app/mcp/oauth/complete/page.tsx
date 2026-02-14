"use client";

import { useEffect } from "react";

type PopupMessage =
  | {
      type: "executor:mcp-oauth-result";
      ok: true;
      sourceUrl: string;
      payload: {
        accessToken: string;
        refreshToken?: string;
        scope?: string;
        expiresIn?: number;
      };
    }
  | {
      type: "executor:mcp-oauth-result";
      ok: false;
      error: string;
    };

function fallbackErrorMessage(error: unknown): PopupMessage {
  return {
    type: "executor:mcp-oauth-result",
    ok: false,
    error: error instanceof Error ? error.message : "Failed to finalize OAuth",
  };
}

export default function McpOAuthCompletePage() {
  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      let message: PopupMessage;
      try {
        const response = await fetch("/mcp/oauth/result", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = await response.json() as PopupMessage;
        if (!data || data.type !== "executor:mcp-oauth-result") {
          throw new Error("Invalid OAuth completion payload");
        }
        message = data;
      } catch (error) {
        message = fallbackErrorMessage(error);
      }

      if (cancelled) {
        return;
      }

      try {
        if (window.opener) {
          window.opener.postMessage(message, window.location.origin);
        }
      } finally {
        window.close();
      }
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center space-y-2">
        <h1 className="text-base font-medium">Finishing OAuth</h1>
        <p className="text-sm text-muted-foreground">You can close this window if it does not close automatically.</p>
      </div>
    </main>
  );
}
