import { tool } from "ai";
import type { ToolSet } from "ai";
import * as Effect from "effect/Effect";
import { z } from "zod";

import {
  createToolsFromRecord,
  type CodeExecutor,
  type CodeToolOutput,
  type ExecuteResult,
  type ExecutableTool,
  type ToolMap,
  type ToolInvoker,
} from "@executor-v3/codemode-core";

export type AiSdkToolMap = ToolSet;

export const CodeToolInputSchema = z.object({
  code: z.string(),
});

export type CodeToolInput = z.infer<typeof CodeToolInputSchema>;

export function createToolsFromAiSdkTools(input: {
  tools: AiSdkToolMap;
  sourceKey?: string;
}): ToolMap {
  return createToolsFromRecord({
    tools: input.tools as Record<string, ExecutableTool>,
    sourceKey: input.sourceKey,
  });
}

export function createCodeTool(input: {
  toolInvoker: ToolInvoker;
  executor: CodeExecutor;
  description?: string;
}) {
  return tool({
    description:
      input.description
      ?? [
        "Write JavaScript and run it against tools.",
        "Use `await tools.<path>(input)` for tool calls.",
      ].join("\n"),
    inputSchema: CodeToolInputSchema,
    execute: ({ code }: CodeToolInput): Promise<CodeToolOutput> =>
      Effect.runPromise(
        input.executor.execute(code, input.toolInvoker).pipe(
          Effect.flatMap((result: ExecuteResult) =>
            result.error
              ? Effect.fail(new Error(result.error))
              : Effect.succeed({
                  code,
                  result: result.result,
                  logs: result.logs,
                } satisfies CodeToolOutput),
          ),
          Effect.mapError((cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          ),
        ),
      ),
  });
}
