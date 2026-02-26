import { describe, expect, it } from "@effect/vitest";
import {
  makeDenoSubprocessRuntimeAdapter,
  makeToolProviderRegistry,
  ToolProviderRegistryService,
} from "@executor-v2/engine";
import { createExecutorRunClient } from "@executor-v2/sdk";
import type { ExecuteRunResult } from "@executor-v2/sdk";
import { createGateway, generateText, stepCountIs, tool } from "ai";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";

import { toAiSdkTools } from "./index";

const gateway = createGateway();

describe("toAiSdkTools", () => {
  it.effect(
    "generates a tool call via generateText with a mock executor",
    () =>
      Effect.gen(function* () {
        const executionLog: Array<{ code: string; timeoutMs?: number }> = [];

        const mockResult: ExecuteRunResult = {
          runId: "run-test-123",
          status: "completed",
          result: 42,
        };

        const runClient = createExecutorRunClient(async (input) => {
          executionLog.push({ code: input.code, timeoutMs: input.timeoutMs });
          return mockResult;
        });

        const tools = toAiSdkTools({
          runClient,
          makeTool: (def) => tool(def),
          defaults: { timeoutMs: 30_000 },
        });

        const result = yield* Effect.tryPromise(() =>
          generateText({
            model: gateway("openai/gpt-4o-mini"),
            tools,
            stopWhen: stepCountIs(3),
            system:
              "You have an execute tool that runs JavaScript code. Always use it when asked to run code.",
            prompt:
              'Run this code using the execute tool: console.log("hello")',
          }),
        );

        // Our mock ExecutorRunClient should have been invoked
        expect(executionLog.length).toBeGreaterThanOrEqual(1);
        expect(executionLog[0]!.code).toBeTypeOf("string");
        expect(executionLog[0]!.code.length).toBeGreaterThan(0);

        // timeoutMs should be set — either by the model or by the default
        expect(executionLog[0]!.timeoutMs).toBeTypeOf("number");

        // Check the steps contain a tool call
        const toolCallSteps = result.steps.filter(
          (step) => step.toolCalls.length > 0,
        );
        expect(toolCallSteps.length).toBeGreaterThanOrEqual(1);

        const firstToolCall = toolCallSteps[0]!.toolCalls[0]!;
        expect(firstToolCall.toolName).toBe("execute");
        expect(firstToolCall.input).toHaveProperty("code");

        // Tool results should contain our mock response
        const toolResultSteps = result.steps.filter(
          (step) => step.toolResults.length > 0,
        );
        expect(toolResultSteps.length).toBeGreaterThanOrEqual(1);
        const toolResult = toolResultSteps[0]!.toolResults[0]!;
        expect(toolResult.toolName).toBe("execute");
        expect(toolResult.output).toMatchObject(mockResult);

        // The model should have produced a final text response
        expect(result.text).toBeTypeOf("string");
      }),
    { timeout: 30_000 },
  );

  it.effect(
    "executes code in a real Deno subprocess via generateText",
    () =>
      Effect.gen(function* () {
        const runtimeAdapter = makeDenoSubprocessRuntimeAdapter({
          defaultTimeoutMs: 10_000,
        });

        const toolProviderRegistry = makeToolProviderRegistry([]);

        // Build an Effect runtime that has the ToolProviderRegistryService
        const effectRuntime = yield* Effect.runtime<never>();
        const runPromise = Runtime.runPromise(effectRuntime);

        const runClient = createExecutorRunClient(async (input) => {
          const runId = `run_${crypto.randomUUID()}`;

          try {
            const result = await runPromise(
              runtimeAdapter
                .execute({
                  code: input.code,
                  tools: [],
                  timeoutMs: input.timeoutMs,
                })
                .pipe(
                  Effect.provideService(
                    ToolProviderRegistryService,
                    toolProviderRegistry,
                  ),
                ),
            );

            return { runId, status: "completed", result } satisfies ExecuteRunResult;
          } catch (error) {
            return {
              runId,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            } satisfies ExecuteRunResult;
          }
        });

        const tools = toAiSdkTools({
          runClient,
          makeTool: (def) => tool(def),
        });

        const result = yield* Effect.tryPromise(() =>
          generateText({
            model: gateway("openai/gpt-4o-mini"),
            tools,
            stopWhen: stepCountIs(3),
            system: [
              "You have an execute tool that runs JavaScript code in a sandboxed Deno runtime.",
              "Always use it when asked to run code.",
              "The code must use `return` to produce a result value.",
            ].join(" "),
            prompt: "Use the execute tool to compute 2 + 3. The code should be: return 2 + 3;",
          }),
        );

        // Check the steps contain a tool call
        const toolCallSteps = result.steps.filter(
          (step) => step.toolCalls.length > 0,
        );
        expect(toolCallSteps.length).toBeGreaterThanOrEqual(1);

        const firstToolCall = toolCallSteps[0]!.toolCalls[0]!;
        expect(firstToolCall.toolName).toBe("execute");

        // Tool results should show the code was executed successfully in Deno
        const toolResultSteps = result.steps.filter(
          (step) => step.toolResults.length > 0,
        );
        expect(toolResultSteps.length).toBeGreaterThanOrEqual(1);

        const toolResult = toolResultSteps[0]!.toolResults[0]!;
        expect(toolResult.toolName).toBe("execute");
        expect(toolResult.output).toMatchObject({
          status: "completed",
          result: 5,
        });

        // The model should have produced a final text response
        expect(result.text).toBeTypeOf("string");
      }),
    { timeout: 30_000 },
  );
});
