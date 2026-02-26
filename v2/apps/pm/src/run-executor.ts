import {
  makeToolProviderRegistry,
  ToolProviderRegistryService,
  type RuntimeAdapter,
} from "@executor-v2/engine";
import type { ExecuteRunInput, ExecuteRunResult } from "@executor-v2/sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type PmRunExecutorService = {
  executeRun: (
    input: ExecuteRunInput,
  ) => Effect.Effect<ExecuteRunResult, never, ToolProviderRegistryService>;
};

export class PmRunExecutor extends Context.Tag("@executor-v2/app-pm/PmRunExecutor")<
  PmRunExecutor,
  PmRunExecutorService
>() {}

const errorToText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
};

const makeExecuteRun = (runtimeAdapter: RuntimeAdapter) =>
  Effect.fn("@executor-v2/app-pm/run-executor.executeRun")(function* (
    input: ExecuteRunInput,
  ) {
    const runId = `run_${crypto.randomUUID()}`;

    const isAvailable = yield* runtimeAdapter.isAvailable();
    if (!isAvailable) {
      return {
        runId,
        status: "failed",
        error: `Runtime '${runtimeAdapter.kind}' is not available in this PM process.`,
      } satisfies ExecuteRunResult;
    }

    return yield* runtimeAdapter
      .execute({
        code: input.code,
        timeoutMs: input.timeoutMs,
        tools: [],
      })
      .pipe(
        Effect.map(
          (result): ExecuteRunResult => ({
            runId,
            status: "completed",
            result,
          }),
        ),
        Effect.catchAll((error) =>
          Effect.succeed({
            runId,
            status: "failed",
            error: errorToText(error),
          } satisfies ExecuteRunResult),
        ),
      );
  });

export const PmRunExecutorLive = (runtimeAdapter: RuntimeAdapter) =>
  Layer.succeed(
    PmRunExecutor,
    PmRunExecutor.of({
      executeRun: makeExecuteRun(runtimeAdapter),
    }),
  );

export const PmToolProviderRegistryLive = Layer.succeed(
  ToolProviderRegistryService,
  makeToolProviderRegistry([]),
);
