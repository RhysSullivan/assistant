import type { CodeModeRunResult } from "@openassistant/core";
import { describe, expect, it } from "vitest";
import { formatDiscordResponse } from "./format-response.js";

describe("formatDiscordResponse", () => {
  it("renders a polished verified calendar summary", () => {
    const output = formatDiscordResponse({
      prompt: "Add 3 calendar events",
      text: "Added three events.",
      planner: "Claude tool-loop (3 code runs).",
      provider: "claude",
      runs: [
        { code: "run1", result: runResult("a", "succeeded", "Dinner @ 2026-02-07T17:00:00.000Z") },
        { code: "run2", result: runResult("b", "succeeded", "Lunch @ 2026-02-08T14:00:00.000Z") },
        { code: "run3", result: runResult("c", "succeeded", "Breakfast @ 2026-02-09T03:00:00.000Z") },
      ],
    });

    expect(output.message).toContain("Added 3 calendar events.");
    expect(output.message).toContain("- Dinner -");
    expect(output.message).toContain("- Lunch -");
    expect(output.message).toContain("- Breakfast -");
    expect(output.footer).toBeDefined();
    expect(output.footer).toContain("Activity: 3 tool calls, 3 approved.");
  });

  it("shows concise recovery message when some attempts fail but success exists", () => {
    const output = formatDiscordResponse({
      prompt: "Delete event",
      text: "Could not complete request.",
      planner: "Claude tool-loop (2 code runs).",
      provider: "claude",
      runs: [
        {
          code: "bad",
          result: {
            ok: false,
            error: "Typecheck failed: Property 'create' does not exist",
            receipts: [],
          },
        },
        { code: "good", result: runResult("ok", "succeeded", "Dinner @ 2026-02-07T17:00:00.000Z") },
      ],
    });

    expect(output.message).toContain("Added 1 calendar event.");
    expect(output.message).toContain("Recovered from 1 issue during execution.");
    expect(output.message).not.toContain("code run failed");
  });

  it("shows actionable error message when nothing succeeded", () => {
    const output = formatDiscordResponse({
      prompt: "Delete event",
      text: "Could not complete request.",
      planner: "Claude tool-loop (1 code run).",
      provider: "claude",
      runs: [
        {
          code: "run",
          result: {
            ok: false,
            error: "Typecheck failed: Property 'create' does not exist",
            receipts: [],
          },
        },
      ],
    });

    expect(output.message).toContain("I couldn't complete that request.");
    expect(output.message).toContain("I hit an issue:");
    expect(output.message).toContain("Typecheck failed");
  });
});

function runResult(
  callId: string,
  status: "succeeded" | "failed",
  inputPreview: string,
): CodeModeRunResult {
  return {
    ok: true,
    value: { ok: true },
    receipts: [
      {
        callId,
        toolPath: "calendar.update",
        kind: "write",
        approval: "required",
        decision: "approved",
        status,
        timestamp: "2026-02-06T01:00:00.000Z",
        inputPreview,
      },
    ],
  };
}
