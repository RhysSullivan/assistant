import { createFileRoute } from "@tanstack/react-router";
import { handleApiRequest } from "../server/api-handler";

export const Route = createFileRoute("/v1/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRequest(request),
      POST: ({ request }) => handleApiRequest(request),
      PUT: ({ request }) => handleApiRequest(request),
      DELETE: ({ request }) => handleApiRequest(request),
      PATCH: ({ request }) => handleApiRequest(request),
    },
  },
});
