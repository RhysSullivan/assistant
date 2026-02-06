import type { CodeModeRunResult, ToolCallReceipt } from "@openassistant/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./agent-loop.js";

describe("runAgentLoop", () => {
  it("tracks three code runs when claude tool loop executes run_code three times", async () => {
    let runCount = 0;

    const result = await Effect.runPromise(
      runAgentLoop({
        prompt: "please schedule dinner, lunch, and breakfast",
        now: new Date("2026-02-06T10:00:00.000Z"),
        runCode: (_code) => {
          runCount += 1;
          return Effect.succeed(succeededRun(runCount));
        },
        runPlanner: ({ executeCode }) =>
          Effect.gen(function* () {
            yield* executeCode({
              code: "await tools.calendar.update({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });",
            });
            yield* executeCode({
              code: "await tools.calendar.update({ title: 'Lunch', startsAt: '2026-02-08T14:00:00.000Z' });",
            });
            yield* executeCode({
              code: "await tools.calendar.update({ title: 'Breakfast', startsAt: '2026-02-09T03:00:00.000Z' });",
            });
            return {
              plannerName: "test",
              text: "Added 3 calendar events.",
              modelID: "claude-3-7-sonnet-latest",
              authSource: "test",
            };
          }),
      }),
    );

    expect(result.text).toContain("3 calendar events");
    expect(result.runs).toHaveLength(3);
    expect(runCount).toBe(3);
    expect(result.runs.flatMap((run) => run.result.receipts)).toHaveLength(3);
    expect(result.planner).toContain("3 code runs");
  });

  it("rejects invalid generated tool code via typecheck before execution", async () => {
    let runCount = 0;

    const result = await Effect.runPromise(
      runAgentLoop({
        prompt: "add dinner event",
        now: new Date("2026-02-06T10:00:00.000Z"),
        runCode: (_code) => {
          runCount += 1;
          return Effect.succeed(succeededRun(runCount));
        },
        runPlanner: ({ executeCode }) =>
          Effect.gen(function* () {
            yield* executeCode({
              code: "await tools.calendar.create({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });",
            });
            yield* executeCode({
              code: "await tools.calendar.update({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });",
            });
            return {
              plannerName: "test",
              text: "done",
              modelID: "claude-3-7-sonnet-latest",
              authSource: "test",
            };
          }),
      }),
    );

    expect(runCount).toBe(1);
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]?.result.ok).toBe(false);
    if (result.runs[0] && !result.runs[0].result.ok) {
      expect(result.runs[0].result.error).toContain("Typecheck failed");
      expect(result.runs[0].result.error).toContain("Property 'create' does not exist");
    }
    expect(result.runs[1]?.result.ok).toBe(true);
  });

  it("returns a failure response when claude generation fails", async () => {
    const codeRuns: string[] = [];

    await expect(
      Effect.runPromise(
        runAgentLoop({
          prompt: "update my calendar to put dinner with ella at 5 pm",
          now: new Date("2026-02-06T10:00:00.000Z"),
          runCode: (code) => {
            codeRuns.push(code);
            return Effect.succeed(succeededRun(1));
          },
          runPlanner: () => Effect.fail(new Error("claude unavailable")),
        }),
      ),
    ).rejects.toThrow("claude unavailable");

    expect(codeRuns).toHaveLength(0);
  });

  it("allows a zero-tool response when claude does not call run_code", async () => {
    const codeRuns: string[] = [];

    const result = await Effect.runPromise(
      runAgentLoop({
        prompt: "Please add dinner at 5pm tomorrow to my calendar",
        now: new Date("2026-02-06T10:00:00.000Z"),
        runCode: (code) => {
          codeRuns.push(code);
          return Effect.succeed(succeededRun(1));
        },
        runPlanner: () =>
          Effect.succeed({
            plannerName: "test",
            text: "I added it.",
            modelID: "claude-3-7-sonnet-latest",
            authSource: "test",
          }),
      }),
    );

    expect(result.runs).toHaveLength(0);
    expect(codeRuns).toHaveLength(0);
    expect(result.planner).toContain("0 code runs");
    expect(result.text).toBe("I added it.");
  });
});

function succeededRun(index: number): CodeModeRunResult {
  const receipts: ToolCallReceipt[] = [
    {
      callId: `call_${index}`,
      toolPath: "calendar.update",
      kind: "write",
      approval: "required",
      decision: "approved",
      status: "succeeded",
      timestamp: `2026-02-06T0${index}:00:00.000Z`,
      inputPreview: `Event ${index}`,
    },
  ];

  return {
    ok: true,
    value: { id: `evt_${index}` },
    receipts,
  };
}
