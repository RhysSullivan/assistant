type SchedulerLike = {
  runAfter: (delayMs: number, functionReference: any, args: any) => Promise<any>;
};

function isTestProcess(): boolean {
  if (process.env.NODE_ENV === "test") {
    return true;
  }

  if (process.env.BUN_TEST === "1") {
    return true;
  }

  const argv = process.argv.join(" ");
  return argv.includes(".test.ts");
}

export function isSchedulerDisabled(): boolean {
  return process.env.DISABLE_CONVEX_SCHEDULER === "1" || isTestProcess();
}

export async function safeRunAfter(
  scheduler: SchedulerLike | undefined,
  delayMs: number,
  functionReference: any,
  args: any,
): Promise<boolean> {
  if (!scheduler || isSchedulerDisabled()) {
    return false;
  }

  try {
    await scheduler.runAfter(delayMs, functionReference, args);
    return true;
  } catch {
    // Best effort only.
    return false;
  }
}
