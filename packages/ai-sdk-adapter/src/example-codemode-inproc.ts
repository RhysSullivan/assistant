import { tool } from "ai";
import * as Effect from "effect/Effect";
import { z } from "zod";

import { makeInProcessExecutor } from "@executor-v3/runtime-local-inproc";

import { createCodeTool, executeCodeWithTools, toExecutorTool } from "./index";

const addNumbers = tool({
  description: "Add two numbers",
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
});

const notify = tool({
  description: "Send notification message",
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }: { message: string }) => ({ delivered: true, message }),
});

const tools = {
  "math.add": addNumbers,
  "notifications.send": toExecutorTool({
    tool: notify,
    metadata: {
      interaction: "required",
    },
  }),
};

const executor = makeInProcessExecutor();

export const codemode = createCodeTool({
  tools,
  executor,
});

export const runCodemodeDemo = async () =>
  Effect.runPromise(
    executeCodeWithTools({
      tools,
      executor,
      code: [
        "const math = await tools.math.add({ a: 2, b: 3 });",
        "await tools.notifications.send({ message: `sum is ${math.sum}` });",
        "return math;",
      ].join("\n"),
    }),
  );
