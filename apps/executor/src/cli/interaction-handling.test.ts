import { describe, expect, it } from "@effect/vitest";

import { decideInteractionHandling } from "./interaction-handling";

describe("interaction-handling", () => {
  it("keeps URL interactions distinct when the terminal is non-interactive", () => {
    expect(decideInteractionHandling({
      parsed: {
        mode: "url",
        message: "Connect Axiom",
        url: "https://mcp.axiom.co/authorize",
      },
      isInteractiveTerminal: false,
    })).toBe("url_paused");
  });

  it("waits on URL interactions in an interactive terminal", () => {
    expect(decideInteractionHandling({
      parsed: {
        mode: "url",
        message: "Connect Axiom",
        url: "https://mcp.axiom.co/authorize",
      },
      isInteractiveTerminal: true,
    })).toBe("url_interactive");
  });

  it("falls back to form pause handling for non-interactive prompts", () => {
    expect(decideInteractionHandling({
      parsed: {
        mode: "form",
        message: "Approve tool call",
      },
      isInteractiveTerminal: false,
    })).toBe("form_paused");
  });
});
