/**
 * Test: sandbox loop behavior — list items, then mutate each in a for loop.
 * Reproduces the "works for 1, breaks for many" issue.
 */

import { test, expect, describe } from "bun:test";
import { createRunner } from "./runner.js";
import { defineTool, type ToolTree } from "./tools.js";
import { z } from "zod";

// Simulate an API: list items, then update each
const items = [
  { id: 1, title: "Issue 1", state: "closed" },
  { id: 2, title: "Issue 2", state: "closed" },
  { id: 3, title: "Issue 3", state: "closed" },
  { id: 4, title: "Issue 4", state: "closed" },
  { id: 5, title: "Issue 5", state: "closed" },
];

let updateCallCount = 0;

const tools: ToolTree = {
  api: {
    list_items: defineTool({
      description: "List items",
      approval: "auto",
      args: z.object({ state: z.string().optional() }),
      returns: z.array(z.object({ id: z.number(), title: z.string(), state: z.string() })),
      run: async (input) => {
        const filtered = input.state
          ? items.filter((i) => i.state === input.state)
          : items;
        return filtered;
      },
    }),
    update_item: defineTool({
      description: "Update an item",
      approval: "auto",
      args: z.object({ id: z.number(), state: z.string() }),
      returns: z.object({ id: z.number(), state: z.string() }),
      run: async (input) => {
        updateCallCount++;
        // Simulate a small network delay
        await new Promise((r) => setTimeout(r, 10));
        return { id: input.id, state: input.state };
      },
    }),
  },
};

describe("sandbox loop — list then mutate each", () => {
  test("for loop with await works for multiple items", async () => {
    updateCallCount = 0;

    const runner = createRunner({
      tools,
      requestApproval: async () => "approved",
      timeoutMs: 30_000,
    });

    const code = `
const items = await tools.api.list_items({ state: "closed" });

const results = [];
for (const item of items) {
  const updated = await tools.api.update_item({ id: item.id, state: "open" });
  results.push(updated);
}

return { total: results.length, results };
`;

    const result = await runner.run(code);

    console.log("Result:", JSON.stringify(result.value));
    console.log("OK:", result.ok);
    console.log("Error:", result.error);
    console.log("Receipts:", result.receipts.length);
    console.log("Update calls:", updateCallCount);

    expect(result.ok).toBe(true);
    expect(result.receipts.length).toBe(6); // 1 list + 5 updates
    expect(updateCallCount).toBe(5);
    expect((result.value as any).total).toBe(5);
  });

  test("Promise.all with map works for multiple items", async () => {
    updateCallCount = 0;

    const runner = createRunner({
      tools,
      requestApproval: async () => "approved",
      timeoutMs: 30_000,
    });

    const code = `
const items = await tools.api.list_items({ state: "closed" });

const results = await Promise.all(
  items.map((item) => tools.api.update_item({ id: item.id, state: "open" }))
);

return { total: results.length, results };
`;

    const result = await runner.run(code);

    console.log("Result:", JSON.stringify(result.value));
    console.log("OK:", result.ok);
    console.log("Error:", result.error);

    expect(result.ok).toBe(true);
    expect(result.receipts.length).toBe(6);
    expect(updateCallCount).toBe(5);
  });

  test("for loop with approval-required tools", async () => {
    const approvalTools: ToolTree = {
      api: {
        list_items: defineTool({
          description: "List items",
          approval: "auto",
          args: z.object({}),
          returns: z.array(z.object({ id: z.number() })),
          run: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
        }),
        update_item: defineTool({
          description: "Update item",
          approval: "required",
          args: z.object({ id: z.number(), state: z.string() }),
          returns: z.object({ id: z.number(), state: z.string() }),
          run: async (input) => ({ id: input.id, state: input.state }),
        }),
      },
    };

    const runner = createRunner({
      tools: approvalTools,
      requestApproval: async () => "approved",
      timeoutMs: 30_000,
    });

    const code = `
const items = await tools.api.list_items({});
const results = [];
for (const item of items) {
  const updated = await tools.api.update_item({ id: item.id, state: "open" });
  results.push(updated);
}
return { total: results.length, results };
`;

    const result = await runner.run(code);

    console.log("Approval loop result:", JSON.stringify(result.value));
    console.log("OK:", result.ok);
    console.log("Error:", result.error);
    console.log("Receipts:", result.receipts.length);

    expect(result.ok).toBe(true);
    expect(result.receipts.length).toBe(4); // 1 list + 3 updates
    expect((result.value as any).total).toBe(3);
  });

  test("large loop — 20 items", async () => {
    const manyItems = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      title: `Issue ${i + 1}`,
      state: "closed",
    }));

    const manyTools: ToolTree = {
      api: {
        list_items: defineTool({
          description: "List items",
          approval: "auto",
          args: z.object({}),
          returns: z.any(),
          run: async () => manyItems,
        }),
        update_item: defineTool({
          description: "Update item",
          approval: "auto",
          args: z.object({ id: z.number(), state: z.string() }),
          returns: z.object({ id: z.number(), state: z.string() }),
          run: async (input) => {
            await new Promise((r) => setTimeout(r, 5));
            return { id: input.id, state: input.state };
          },
        }),
      },
    };

    const runner = createRunner({
      tools: manyTools,
      requestApproval: async () => "approved",
      timeoutMs: 30_000,
    });

    const code = `
const items = await tools.api.list_items({});
const results = [];
for (const item of items) {
  const updated = await tools.api.update_item({ id: item.id, state: "open" });
  results.push(updated);
}
return { total: results.length };
`;

    const result = await runner.run(code);

    console.log("20 items result:", JSON.stringify(result.value));
    console.log("OK:", result.ok);
    console.log("Error:", result.error);

    expect(result.ok).toBe(true);
    expect((result.value as any).total).toBe(20);
  });
});
