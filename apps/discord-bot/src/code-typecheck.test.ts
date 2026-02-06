import { describe, expect, it } from "vitest";
import { typecheckCodeSnippet } from "./code-typecheck.js";

describe("typecheckCodeSnippet", () => {
  it("accepts valid calendar update tool calls", () => {
    const result = typecheckCodeSnippet(
      "await tools.calendar.update({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });",
    );

    expect(result.ok).toBe(true);
  });

  it("rejects unknown tool calls", () => {
    const result = typecheckCodeSnippet(
      "await tools.calendar.create({ title: 'Dinner', startsAt: '2026-02-07T17:00:00.000Z' });",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Property 'create' does not exist");
    }
  });
});
