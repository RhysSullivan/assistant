import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeToolInvokerFromTools } from "@executor/codemode-core";
import { makeDenoSubprocessExecutor } from "@executor/runtime-deno-subprocess";

import {
  createControlPlaneRuntime,
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
      executor: makeDenoSubprocessExecutor(),
      toolInvoker,
    });
};

const makeRuntime = Effect.acquireRelease(
  createControlPlaneRuntime({
    localDataDir: ":memory:",
    workspaceRoot: mkdtempSync(join(tmpdir(), "executor-execution-http-")),
    executionResolver: makeExecutionResolver(),
  }),
  (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
);

describe("execution-http", () => {
  it.scoped("creates and persists an execution through the HTTP API", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;

      const createExecution = yield* withControlPlaneClient(
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
      );

      expect(createExecution.execution.status).toBe("completed");
      expect(createExecution.execution.resultJson).toBe(JSON.stringify({ sum: 42 }));
      expect(createExecution.pendingInteraction).toBeNull();

      const getExecution = yield* withControlPlaneClient(
        {
          runtime,
          accountId: installation.accountId,
        },
        (client) =>
          client.executions.get({
            path: {
              workspaceId: installation.workspaceId,
              executionId: createExecution.execution.id,
            },
          }),
      );

      expect(getExecution.execution.id).toBe(createExecution.execution.id);
      expect(getExecution.execution.status).toBe("completed");
      expect(getExecution.pendingInteraction).toBeNull();
    }),
  );
});
