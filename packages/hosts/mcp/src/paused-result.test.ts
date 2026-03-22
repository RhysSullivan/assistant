import { describe, expect, it } from "@effect/vitest";
import type {
  ExecutionEnvelope,
  ExecutionInteraction,
} from "@executor/platform-sdk/schema";

import {
  buildPausedResultText,
  parseInteractionPayload,
} from "./paused-result";

const makeInteraction = (patch: Partial<ExecutionInteraction> = {}): ExecutionInteraction => ({
  id: "exec_123:source_connect_oauth2:call_1" as never,
  executionId: "exec_123" as never,
  status: "pending",
  kind: "url",
  purpose: "source_connect_oauth2",
  payloadJson: JSON.stringify({
    elicitation: {
      mode: "url",
      message: "Finish connecting Axiom",
      url: "https://mcp.axiom.co/authorize",
      elicitationId: "oauth-session-123",
    },
  }),
  responseJson: null,
  responsePrivateJson: null,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const makeEnvelope = (
  patch: Partial<ExecutionEnvelope> = {},
): ExecutionEnvelope => ({
  execution: {
    id: "exec_123" as never,
    scopeId: "ws_123" as never,
    createdByScopeId: "acct_123" as never,
    status: "waiting_for_interaction",
    code: "return await tools.executor.sources.add({ endpoint: 'https://mcp.axiom.co/mcp' });",
    resultJson: null,
    errorText: null,
    logsJson: null,
    startedAt: 1,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
  },
  pendingInteraction: makeInteraction(),
  ...patch,
});

describe("paused-result", () => {
  it("parses the browser URL from a paused interaction payload", () => {
    const parsed = parseInteractionPayload(makeInteraction());

    expect(parsed).not.toBeNull();
    expect(parsed?.mode).toBe("url");
    expect(parsed?.url).toBe("https://mcp.axiom.co/authorize");
    expect(parsed?.elicitationId).toBe("oauth-session-123");
  });

  it("includes URL and resume instructions in the paused text for browser auth", () => {
    const text = buildPausedResultText(makeEnvelope());

    expect(text).toContain("Finish connecting Axiom");
    expect(text).toContain("Open this URL in a browser:");
    expect(text).toContain("https://mcp.axiom.co/authorize");
    expect(text).toContain("executor.resume");
    expect(text).toContain('"executionId": "exec_123"');
  });

  it("includes resume guidance for form interactions", () => {
    const text = buildPausedResultText(
      makeEnvelope({
        pendingInteraction: makeInteraction({
          kind: "form",
          purpose: "tool_execution_gate",
          payloadJson: JSON.stringify({
            elicitation: {
              mode: "form",
              message: "Approve the tool call",
              requestedSchema: {
                type: "object",
                properties: {
                  approve: { type: "boolean" },
                },
                required: ["approve"],
              },
            },
          }),
        }),
      }),
    );

    expect(text).toContain("Approve the tool call");
    expect(text).toContain("include a response object matching the requested schema");
    expect(text).toContain('"executionId": "exec_123"');
  });
});
