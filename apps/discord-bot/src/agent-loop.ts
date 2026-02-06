import type { CodeModeRunResult, ToolCallReceipt } from "@openassistant/core";
import { generateText, stepCountIs, tool } from "ai";
import { Effect } from "effect";
import { getAnthropicModel } from "./anthropic-provider.js";
import { typecheckCodeSnippet } from "./code-typecheck.js";
import { z } from "zod";

const RUN_CODE_TOOL_SCHEMA = z.object({
  code: z.string().min(1),
});

const DEFAULT_ANTHROPIC_MODEL =
  Bun.env.OPENASSISTANT_ANTHROPIC_MODEL?.trim() ??
  Bun.env.OPENASSISTANT_CLAUDE_MODEL?.trim() ??
  "claude-opus-4-5-20251101";
const CLAUDE_TIMEOUT_MS = Number(Bun.env.OPENASSISTANT_CLAUDE_TIMEOUT_MS ?? 60_000);
const CLAUDE_MAX_STEPS = Number(Bun.env.OPENASSISTANT_AGENT_MAX_STEPS ?? 8);

export type AgentCodeRun = {
  code: string;
  result: CodeModeRunResult;
};

export type AgentLoopResult = {
  planner: string;
  text: string;
  runs: AgentCodeRun[];
};

type RunCodeToolInput = z.infer<typeof RUN_CODE_TOOL_SCHEMA>;

type RunCodeToolOutput = {
  ok: boolean;
  receipts: ToolCallReceipt[];
  value?: unknown;
  error?: string;
};

type PlannerInput = {
  prompt: string;
  now: Date;
  executeCode: (input: RunCodeToolInput) => Effect.Effect<RunCodeToolOutput>;
};

type PlannerOutput = {
  plannerName: string;
  text: string;
  modelID: string;
  authSource: string;
};

type RunPlanner = (input: PlannerInput) => Effect.Effect<PlannerOutput, unknown>;

export type RunAgentLoopInput = {
  prompt: string;
  runCode: (code: string) => Effect.Effect<CodeModeRunResult>;
  now: Date;
  runPlanner: RunPlanner;
};

export const runAgentLoop = Effect.fn("AgentLoop.run")(function* (input: RunAgentLoopInput) {
  const runs: AgentCodeRun[] = [];

  const executeCode = Effect.fn("AgentLoop.executeCode")(function* (toolInput: RunCodeToolInput) {
    const typecheck = typecheckCodeSnippet(toolInput.code);
    if (!typecheck.ok) {
      const failed: CodeModeRunResult = {
        ok: false,
        error: `Typecheck failed: ${typecheck.error}`,
        receipts: [],
      };
      runs.push({
        code: toolInput.code,
        result: failed,
      });
      return toRunCodeToolOutput(failed);
    }

    const result = yield* input.runCode(toolInput.code);
    runs.push({
      code: toolInput.code,
      result,
    });
    return toRunCodeToolOutput(result);
  });

  const generated = yield* input.runPlanner({
    prompt: input.prompt,
    now: input.now,
    executeCode,
  });
  return {
    planner: `${generated.plannerName} tool-loop (${runs.length} code runs, model=${generated.modelID}, auth=${generated.authSource}).`,
    text: generated.text,
    runs,
  };
});

export type RunAgentLoopWithAnthropicInput = Omit<RunAgentLoopInput, "runPlanner">;

export const runAgentLoopWithAnthropic = Effect.fn("AgentLoop.runWithAnthropic")(function* (
  input: RunAgentLoopWithAnthropicInput,
) {
  return yield* runAgentLoop({
    ...input,
    runPlanner: runAnthropicPlanner,
  });
});

const runAnthropicPlanner = Effect.fn("AgentLoop.runAnthropicPlanner")(function* (input: PlannerInput) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), CLAUDE_TIMEOUT_MS);

  const generated = yield* Effect.tryPromise({
    try: async () => {
      const { model, authSource } = await getAnthropicModel(DEFAULT_ANTHROPIC_MODEL);
      const result = await generateText({
        model,
        temperature: 0,
        stopWhen: stepCountIs(CLAUDE_MAX_STEPS),
        prompt: buildAgentPrompt(input.prompt, input.now),
        system: buildSystemPrompt(),
        tools: {
          run_code: tool({
            description:
              "Execute Bun TypeScript function body in codemode runtime. Use this for every action that requires tools.* calls.",
            inputSchema: RUN_CODE_TOOL_SCHEMA,
            execute: (args) => Effect.runPromise(input.executeCode(args)),
          }),
        },
        abortSignal: abortController.signal,
      });

      return {
        plannerName: "Anthropic Claude",
        text: result.text.trim() || "Done.",
        modelID: DEFAULT_ANTHROPIC_MODEL,
        authSource,
      } as PlannerOutput;
    },
    catch: (error) => error,
  }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timeout))));

  return generated;
});

function buildSystemPrompt(): string {
  return [
    "You are OpenAssistant. Execute work via the run_code tool and then report what happened.",
    "In your final response, summarize relevant tool activity and mention failures/denials clearly.",
  ].join("\n");
}

function buildAgentPrompt(userPrompt: string, now: Date): string {
  return [
    "run_code expects JavaScript function-body code executed as new AsyncFunction('tools', code).",
    "Inside code, call available tools directly like: await tools.calendar.update({ title, startsAt, notes }).",
    "Prefer a single run_code call that completes the full request end-to-end.",
    "Only issue another run_code call when the prior run failed or was denied and you are retrying with a fix.",
    "For multiple events, produce multiple tool calls in the same code block.",
    "Never claim an action succeeded unless run_code returned ok=true.",
    `Current timestamp: ${now.toISOString()}`,
    `User request: ${userPrompt}`,
  ].join("\n");
}

function toRunCodeToolOutput(result: CodeModeRunResult): RunCodeToolOutput {
  if (result.ok) {
    return {
      ok: true,
      value: result.value,
      receipts: result.receipts,
    };
  }

  return {
    ok: false,
    error: result.error,
    receipts: result.receipts,
  };
}
