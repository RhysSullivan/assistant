import * as Effect from "effect/Effect";

import {
  executeCodeWithTools,
  makeToolInvokerFromTools,
  toExecutorTool,
} from "@executor-v3/ai-sdk-adapter/ai";
import { makeInProcessExecutor } from "@executor-v3/runtime-local-inproc";

const tools = {
  "math.add": {
    execute: ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
  },
  "notifications.send": toExecutorTool({
    tool: {
      execute: ({ message }: { message: string }) => ({ delivered: true, message }),
    },
  }),
};

const run = Effect.gen(function* () {
  const outputWithTools = yield* executeCodeWithTools({
    code: "return await tools.math.add({ a: 20, b: 22 });",
    tools,
    executor: makeInProcessExecutor(),
  });

  const outputWithInvoker = yield* executeCodeWithTools({
    code: "return await tools.math.add({ a: 39, b: 3 });",
    toolInvoker: makeToolInvokerFromTools({ tools }),
    executor: makeInProcessExecutor(),
  });

  return {
    outputWithTools,
    outputWithInvoker,
  };
});

const result = await Effect.runPromise(run);
console.log(JSON.stringify(result, null, 2));
