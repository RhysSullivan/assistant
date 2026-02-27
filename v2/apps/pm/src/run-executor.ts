import {
  makeToolProviderRegistry,
  ToolProviderRegistryService,
  type RuntimeAdapter,
  type RuntimeExecuteError,
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

const formatRuntimeExecuteError = (error: RuntimeExecuteError): string => {
  switch (error._tag) {
    case "RuntimeAdapterError":
    case "LocalCodeRunnerError":
    case "DenoSubprocessRunnerError":
    case "ToolProviderError":
      return error.details ? `${error.message}: ${error.details}` : error.message;
    case "ToolProviderRegistryError":
      return error.message;
  }
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
            error: formatRuntimeExecuteError(error),
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
