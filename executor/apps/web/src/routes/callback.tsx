import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/http/response";

export const Route = createFileRoute("/callback")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const callbackUrl = new URL(request.url);
        return redirectResponse(`/api/auth/callback${callbackUrl.search}`);
      },
    },
  },
});
