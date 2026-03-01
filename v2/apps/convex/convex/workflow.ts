import { WorkflowManager } from "@convex-dev/workflow";

import { components } from "./_generated/api";

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 250,
      base: 2,
    },
    retryActionsByDefault: true,
    maxParallelism: 8,
  },
});
