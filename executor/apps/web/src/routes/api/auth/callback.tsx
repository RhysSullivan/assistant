import { createFileRoute } from "@tanstack/react-router";
import { handleWorkOSCallback } from "@/lib/workos-callback";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: handleWorkOSCallback,
    },
  },
});
