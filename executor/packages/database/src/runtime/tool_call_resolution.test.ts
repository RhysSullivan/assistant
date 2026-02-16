import { describe, expect, test } from "bun:test";
import type { TaskRecord, ToolDefinition } from "../../../core/src/types";
import { getGraphqlDecision } from "./tool_call_resolution";

const task: TaskRecord = {
  id: "task_1",
  code: "",
  runtimeId: "runtime_1",
  status: "running",
  timeoutMs: 30_000,
  metadata: {},
  workspaceId: "workspace_1" as TaskRecord["workspaceId"],
  accountId: "account_1" as TaskRecord["accountId"],
  clientId: "client_1",
  createdAt: 1,
  updatedAt: 1,
};

const graphqlTool: ToolDefinition = {
  path: "linear.graphql",
  source: "graphql:linear",
  approval: "auto",
  description: "Raw GraphQL tool",
  _graphqlSource: "linear",
  run: async () => ({ data: null, errors: [] }),
};

describe("getGraphqlDecision", () => {
  test("supports raw string GraphQL query input", () => {
    const decision = getGraphqlDecision(
      task,
      graphqlTool,
      "query { teams { nodes { id } } }",
      undefined,
      [],
    );

    expect(decision.decision).toBe("allow");
    expect(decision.effectivePaths).toEqual(["linear.query.teams"]);
  });

  test("derives require_approval for raw string mutation input", () => {
    const decision = getGraphqlDecision(
      task,
      graphqlTool,
      "mutation { issueBatchCreate(input: { issues: [] }) { success } }",
      undefined,
      [],
    );

    expect(decision.decision).toBe("require_approval");
    expect(decision.effectivePaths).toEqual(["linear.mutation.issuebatchcreate"]);
  });
});
