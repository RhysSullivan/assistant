import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "../server/api-handler";

export const Route = createFileRoute("/mcp/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      PUT: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
});
