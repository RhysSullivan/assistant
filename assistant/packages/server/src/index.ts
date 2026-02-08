/**
 * Assistant Server entry point.
 */

import { createApp } from "./routes";
import { createExecutorClient } from "./executor-client";

const PORT = Number(Bun.env.PORT ?? 3000);
const EXECUTOR_URL = Bun.env.EXECUTOR_URL ?? "http://localhost:4001";
const CONVEX_URL = Bun.env.CONVEX_URL ?? "http://127.0.0.1:3210";

// Bootstrap anonymous context on executor
const executor = createExecutorClient(EXECUTOR_URL);
const { data: ctx, error: bootstrapError } = await executor.api.auth.anonymous.bootstrap.post({});

if (bootstrapError || !ctx) {
  console.error("Failed to bootstrap executor context. Is the executor running at", EXECUTOR_URL, "?");
  process.exit(1);
}
console.log(`[assistant] executor context: workspace=${ctx.workspaceId} actor=${ctx.actorId}`);

const contextLines: string[] = [];
if (Bun.env.POSTHOG_PROJECT_ID) contextLines.push(`- PostHog project ID: ${Bun.env.POSTHOG_PROJECT_ID}`);

const app = createApp({
  executorUrl: EXECUTOR_URL,
  workspaceId: ctx.workspaceId,
  actorId: ctx.actorId,
  clientId: ctx.clientId,
  context: contextLines.length > 0 ? contextLines.join("\n") : undefined,
  convexUrl: CONVEX_URL,
});

app.listen(PORT);
console.log(`[assistant] server running at http://localhost:${PORT}`);
console.log(`[assistant] executor at ${EXECUTOR_URL}`);

export type { App } from "./routes";
