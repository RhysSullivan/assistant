import { treaty } from "@elysiajs/eden";
import type { App } from "@executor/server/src/index";

export function createExecutorClient(baseUrl: string) {
  return treaty<App>(baseUrl);
}

export type ExecutorClient = ReturnType<typeof createExecutorClient>;
