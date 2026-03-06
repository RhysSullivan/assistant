import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeToolInvokerFromTools } from "@executor-v3/codemode-core";
import { makeInProcessExecutor } from "@executor-v3/runtime-local-inproc";

import {
  makeSqlControlPlaneRuntime,
} from "./index";
import { withControlPlaneClient } from "./test-http-client";

const makeExecutionResolver = () => {
  const toolInvoker = makeToolInvokerFromTools({
    tools: {
      "math.add": {
        description: "Add two numbers",
        inputSchema: Schema.standardSchemaV1(
          Schema.Struct({
            a: Schema.optional(Schema.Number),
            b: Schema.optional(Schema.Number),
          }),
        ),
        execute: ({
          a,
          b,
        }) => ({ sum: (a ?? 0) + (b ?? 0) }),
      },
    },
  });

  return () =>
    Effect.succeed({
      executor: makeInProcessExecutor(),
      toolInvoker,
    });
};

const makeRuntime = Effect.acquireRelease(
  makeSqlControlPlaneRuntime({
    localDataDir: ":memory:",
    executionResolver: makeExecutionResolver(),
  }),
  (runtime) =>
    Effect.tryPromise({
      try: async () => {
        await runtime.close();
        await runtime.webHandler.dispose();
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.orDie),
);

describe("execution-http", () => {
  it.scoped("creates and persists an execution through the HTTP API", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;

      const createExecution = (yield* withControlPlaneClient(
        {
          runtime,
          accountId: installation.accountId,
        },
        (client) =>
          client.executions.create({
            path: {
              workspaceId: installation.workspaceId,
            },
            payload: {
              code: "return await tools.math.add({ a: 20, b: 22 });",
            },
          }),
      )) as {
        id: string;
        status: string;
        resultJson: string | null;
      };

      expect(createExecution.status).toBe("completed");
      expect(createExecution.resultJson).toBe(JSON.stringify({ sum: 42 }));

      const getExecution = (yield* withControlPlaneClient(
        {
          runtime,
          accountId: installation.accountId,
        },
        (client) =>
          client.executions.get({
            path: {
              workspaceId: installation.workspaceId,
              executionId: createExecution.id,
            },
          }),
      )) as {
        id: string;
        status: string;
      };

      expect(getExecution.id).toBe(createExecution.id);
      expect(getExecution.status).toBe("completed");
    }),
  );
});
