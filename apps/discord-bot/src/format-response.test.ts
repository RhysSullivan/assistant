import type { CodeModeRunResult } from "@openassistant/core";
import { describe, expect, it } from "vitest";
import { formatDiscordResponse } from "./format-response.js";

describe("formatDiscordResponse", () => {
  it("summarizes tool activity across multiple runs", () => {
    const output = formatDiscordResponse({
      prompt: "Add 3 calendar events",
      text: "Added three events.",
      planner: "Claude tool-loop (3 code runs).",
      provider: "claude",
      runs: [
        { code: "run1", result: runResult("a", "succeeded") },
        { code: "run2", result: runResult("b", "succeeded") },
        { code: "run3", result: runResult("c", "succeeded") },
      ],
    });

    expect(output).toContain("Code runs: 3");
    expect(output).toContain("`calendar.update`");
    expect(output).toContain("3 calls");
    expect(output).toContain("3 approved");
    expect(output).toContain("3 succeeded");
  });

  it("includes failure details for denied/failed receipts", () => {
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
            error: "Tool call denied",
            receipts: [
              {
                callId: "call_denied",
                toolPath: "calendar.update",
                kind: "write",
                approval: "required",
                decision: "denied",
                status: "denied",
                timestamp: "2026-02-06T01:00:00.000Z",
              },
            ],
          },
        },
      ],
    });

    expect(output).toContain("Failures:");
    expect(output).toContain("code run failed");
    expect(output).toContain("denied");
  });
});

function runResult(callId: string, status: "succeeded" | "failed"): CodeModeRunResult {
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
      },
    ],
  };
}
