import {
  LocalCodeRunnerError,
  executeJavaScriptWithTools,
} from "@executor-v2/engine/local-runner";
import {
  ToolProviderError,
  ToolProviderRegistryError,
  ToolProviderRegistryService,
  type CanonicalToolDescriptor,
} from "@executor-v2/engine/tool-providers";
import type { Source } from "@executor-v2/schema";
import * as Effect from "effect/Effect";

export type RuntimeRunnableTool = {
  descriptor: CanonicalToolDescriptor;
  source: Source | null;
};

export type RuntimeExecuteInput = {
  code: string;
  tools: ReadonlyArray<RuntimeRunnableTool>;
  timeoutMs?: number;
};

export type RuntimeExecuteError =
  | LocalCodeRunnerError
  | ToolProviderRegistryError
  | ToolProviderError;

export type RuntimeAdapter = {
  kind: "local-inproc";
  isAvailable: () => Effect.Effect<boolean>;
  execute: (
    input: RuntimeExecuteInput,
  ) => Effect.Effect<unknown, RuntimeExecuteError, ToolProviderRegistryService>;
};

export const makeLocalInProcessRuntimeAdapter = (): RuntimeAdapter => ({
  kind: "local-inproc",
  isAvailable: () => Effect.succeed(true),
  execute: (input) =>
    executeJavaScriptWithTools({
      code: input.code,
      tools: input.tools,
    }),
});
