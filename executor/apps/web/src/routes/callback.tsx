import { createFileRoute } from "@tanstack/react-router";
import { handleWorkOSCallback } from "@/lib/workos-callback";

export const Route = createFileRoute("/callback")({
  server: {
    handlers: {
      GET: handleWorkOSCallback,
    },
  },
});
