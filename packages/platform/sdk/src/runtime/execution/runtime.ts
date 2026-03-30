import type {
  CodeExecutor,
} from "@executor/codemode-core";
import {
  makeDenoSubprocessExecutor,
} from "@executor/runtime-deno-subprocess";
import {
  makeQuickJsExecutor,
} from "@executor/runtime-quickjs";
import {
  makeSesExecutor,
} from "@executor/runtime-ses";
import type {
  ExecutorScopeConfig,
  ExecutorRuntimeConfig,
} from "#schema";

const DEFAULT_EXECUTION_RUNTIME: ExecutorRuntimeConfig = "quickjs";

export const resolveConfiguredExecutionRuntime = (
  config: ExecutorScopeConfig | null | undefined,
): ExecutorRuntimeConfig => config?.runtime ?? DEFAULT_EXECUTION_RUNTIME;

export const createCodeExecutorForRuntime = (
  runtime: ExecutorRuntimeConfig,
): CodeExecutor => {
  switch (runtime) {
    case "deno":
      return makeDenoSubprocessExecutor();
    case "ses":
      return makeSesExecutor();
    case "quickjs":
    default:
      return makeQuickJsExecutor();
  }
};
