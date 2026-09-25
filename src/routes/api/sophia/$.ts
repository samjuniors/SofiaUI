import { createFileRoute } from "@tanstack/react-router";
import { handleSophiaRequest } from "@/lib/sophia-server";

export const Route = createFileRoute("/api/sophia/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleSophiaRequest(request),
      POST: ({ request }) => handleSophiaRequest(request),
    },
  },
});

