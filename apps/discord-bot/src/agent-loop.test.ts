import type { CodeModeRunResult, ToolCallReceipt } from "@openassistant/core";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./agent-loop.js";

describe("runAgentLoop", () => {
  it("tracks three code runs when claude tool loop executes run_code three times", async () => {
    let runCount = 0;

    const result = await runAgentLoop(
      "please schedule dinner, lunch, and breakfast",
      async (_code) => {
        runCount += 1;
        return succeededRun(runCount);
      },
      {
        runWithClaude: async ({ executeCode }) => {
          await executeCode({ code: "await tools.calendar.update({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });" });
          await executeCode({ code: "await tools.calendar.update({ title: 'Lunch', startsAt: '2026-02-08T14:00:00.000Z' });" });
          await executeCode({ code: "await tools.calendar.update({ title: 'Breakfast', startsAt: '2026-02-09T03:00:00.000Z' });" });
          return {
            text: "Added 3 calendar events.",
            modelID: "claude-3-7-sonnet-latest",
            authSource: "test",
          };
        },
      },
    );

    expect(result.provider).toBe("claude");
    expect(result.text).toContain("3 calendar events");
    expect(result.runs).toHaveLength(3);
    expect(runCount).toBe(3);
    expect(result.runs.flatMap((run) => run.result.receipts)).toHaveLength(3);
    expect(result.planner).toContain("3 code runs");
  });

  it("rejects invalid generated tool code via typecheck before execution", async () => {
    let runCount = 0;

    const result = await runAgentLoop(
      "add dinner event",
      async (_code) => {
        runCount += 1;
        return succeededRun(runCount);
      },
      {
        runWithClaude: async ({ executeCode }) => {
          await executeCode({
            code: "await tools.calendar.create({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });",
          });
          await executeCode({
            code: "await tools.calendar.update({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });",
          });
          return {
            text: "done",
            modelID: "claude-3-7-sonnet-latest",
            authSource: "test",
          };
        },
      },
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

    const result = await runAgentLoop(
      "update my calendar to put dinner with ella at 5 pm",
      async (code) => {
        codeRuns.push(code);
        return succeededRun(1);
      },
      {
        runWithClaude: async () => {
          throw new Error("claude unavailable");
        },
      },
    );

    expect(result.provider).toBe("claude");
    expect(result.planner).toContain("failed before completion");
    expect(result.text).toContain("claude unavailable");
    expect(result.runs).toHaveLength(0);
    expect(codeRuns).toHaveLength(0);
  });

  it("allows a zero-tool response when claude does not call run_code", async () => {
    const codeRuns: string[] = [];

    const result = await runAgentLoop(
      "Please add dinner at 5pm tomorrow to my calendar",
      async (code) => {
        codeRuns.push(code);
        return succeededRun(1);
      },
      {
        runWithClaude: async () => ({
          text: "I added it.",
          modelID: "claude-3-7-sonnet-latest",
          authSource: "test",
        }),
      },
    );

    expect(result.provider).toBe("claude");
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
