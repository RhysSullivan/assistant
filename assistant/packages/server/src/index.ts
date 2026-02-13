import { createApp } from "./routes";
import { defaultLinksFilePath } from "./link-store";

const PORT = Number(Bun.env.ASSISTANT_PORT ?? Bun.env.PORT ?? 3002);
const CONVEX_URL = Bun.env.CONVEX_URL;
if (!CONVEX_URL) {
  throw new Error("CONVEX_URL is required. Set it in your environment.");
}

const EXECUTOR_URL = Bun.env.EXECUTOR_URL
  ?? Bun.env.CONVEX_SITE_URL
  ?? (CONVEX_URL.includes(".convex.cloud")
    ? CONVEX_URL.replace(".convex.cloud", ".convex.site")
    : CONVEX_URL);

const contextLines: string[] = [];
if (Bun.env.POSTHOG_PROJECT_ID) {
  contextLines.push(`- PostHog project ID: ${Bun.env.POSTHOG_PROJECT_ID}`);
}

const linksFile = Bun.env.ASSISTANT_LINKS_FILE ?? defaultLinksFilePath;

const app = createApp({
  executorUrl: EXECUTOR_URL,
  convexUrl: CONVEX_URL,
  context: contextLines.length > 0 ? contextLines.join("\n") : undefined,
  defaultClientId: Bun.env.ASSISTANT_CLIENT_ID ?? "assistant-chat",
  linksFile,
});

app.listen(PORT);
console.log(`[assistant] server running at http://localhost:${PORT}`);
console.log(`[assistant] executor at ${EXECUTOR_URL}`);
console.log(`[assistant] link store at ${linksFile}`);

export type { App } from "./routes";
