import { expect, test } from "bun:test";
import type { ToolDefinition } from "../../../core/src/types";
import { listVisibleToolDescriptors } from "./tool_descriptors";

test("listVisibleToolDescriptors derives display hints from schemas", () => {
  const tool: ToolDefinition = {
    path: "github.actions.add_custom_labels_to_self_hosted_runner_for_org",
    description: "Add custom labels",
    approval: "required",
    source: "openapi:github",
    typing: {
      inputSchema: {
        type: "object",
        properties: {
          org: { type: "string" },
          runner_id: { type: "number" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["org", "runner_id", "labels"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          total_count: { type: "number" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["total_count", "labels"],
        additionalProperties: true,
      },
    },
    run: async () => ({ total_count: 0, labels: [] }),
  };

  const tools = new Map<string, ToolDefinition>([[tool.path, tool]]);
  const descriptors = listVisibleToolDescriptors(
    tools,
    { workspaceId: "w" },
    [],
    { includeDetails: true },
  );

  expect(descriptors).toHaveLength(1);
  const descriptor = descriptors[0]!;
  expect(descriptor.display?.input).toContain("org");
  expect(descriptor.display?.input).toContain("runner_id");
  expect(descriptor.display?.output).toContain("total_count");
  expect(descriptor.typing?.requiredInputKeys).toEqual(expect.arrayContaining(["org", "runner_id", "labels"]));
  expect(descriptor.typing?.previewInputKeys).toEqual(expect.arrayContaining(["org", "runner_id"]));
});

test("listVisibleToolDescriptors ignores OpenAPI typed hints when schemas are present", () => {
  const tool: ToolDefinition = {
    path: "stripe.delete_accounts_account_bank_accounts_id",
    description: "Delete an external account",
    approval: "required",
    source: "openapi:stripe",
    typing: {
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "object",
            properties: {
              account: { type: "string" },
              id: { type: "string" },
            },
            required: ["account", "id"],
          },
        },
        required: ["path"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deleted: { type: "boolean" },
          id: { type: "string" },
        },
        required: ["deleted", "id"],
      },
      inputHint: "{ path: string; body?: Record<string, unknown> }",
      outputHint: "string",
      typedRef: {
        kind: "openapi_operation",
        sourceKey: "openapi:stripe",
        operationId: "DeleteAccountsAccountBankAccountsID",
      },
    },
    run: async () => ({ deleted: true, id: "ba_123" }),
  };

  const tools = new Map<string, ToolDefinition>([[tool.path, tool]]);
  const [descriptor] = listVisibleToolDescriptors(tools, { workspaceId: "w" }, [], { includeDetails: true });

  expect(descriptor).toBeDefined();
  expect(descriptor!.display?.input).toContain("path");
  expect(descriptor!.display?.input).not.toContain("body?: Record<string, unknown>");
  expect(descriptor!.display?.output).toContain("deleted");
  expect(descriptor!.display?.output).not.toBe("string");
});

test("listVisibleToolDescriptors falls back to OpenAPI typed hints for $ref-only schemas", () => {
  const tool: ToolDefinition = {
    path: "stripe.delete_accounts_account_bank_accounts_id",
    description: "Delete an external account",
    approval: "required",
    source: "openapi:stripe",
    typing: {
      outputSchema: {
        $ref: "#/components/schemas/deleted_external_account",
      },
      outputHint: "{ deleted: true; id: string; object: \"bank_account\" } | { object: \"card\" }",
      typedRef: {
        kind: "openapi_operation",
        sourceKey: "openapi:stripe",
        operationId: "DeleteAccountsAccountBankAccountsID",
      },
    },
    run: async () => ({ deleted: true, id: "ba_123", object: "bank_account" }),
  };

  const tools = new Map<string, ToolDefinition>([[tool.path, tool]]);
  const [descriptor] = listVisibleToolDescriptors(tools, { workspaceId: "w" }, [], { includeDetails: true });

  expect(descriptor).toBeDefined();
  expect(descriptor!.display?.output).toContain("deleted: true");
  expect(descriptor!.display?.output).not.toContain("$ref");
});
