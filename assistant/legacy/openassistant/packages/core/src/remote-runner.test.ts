import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool, type ToolTree } from "./tools.js";
import { createRemoteRunner } from "./remote-runner.js";

describe("remote runner", () => {
  test("sends run request with tool manifest", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;

    const tools: ToolTree = {
      math: {
        add: defineTool({
          description: "Add two numbers",
          approval: "auto",
          args: z.object({ a: z.number(), b: z.number() }),
          returns: z.number(),
          run: async (input) => input.a + input.b,
        }),
      },
      db: {
        delete: defineTool({
          description: "Delete a row",
          approval: "required",
          args: z.object({ id: z.string() }),
          returns: z.object({ deleted: z.boolean() }),
          run: async () => ({ deleted: true }),
        }),
      },
    };

    const runner = createRemoteRunner({
      tools,
      executorUrl: "http://executor.local",
      runId: "run_123",
      callbackBaseUrl: "http://api.local",
      callbackToken: "token_123",
      timeoutMs: 5_000,
      fetchImpl: async (url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(
          JSON.stringify({ ok: true, value: 42, receipts: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await runner.run("return 42;");

    expect(capturedUrl).toBe("http://executor.local/internal/execute");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);

    const request = capturedBody as {
      runId: string;
      timeoutMs: number;
      callbackBaseUrl: string;
      callbackToken: string;
      tools: Array<{ toolPath: string; approval: string }>;
    };
    expect(request.runId).toBe("run_123");
    expect(request.timeoutMs).toBe(5_000);
    expect(request.callbackBaseUrl).toBe("http://api.local");
    expect(request.callbackToken).toBe("token_123");
    expect(request.tools).toContainEqual({ toolPath: "math.add", approval: "auto" });
    expect(request.tools).toContainEqual({ toolPath: "db.delete", approval: "required" });
  });

  test("returns error when executor response is invalid", async () => {
    const runner = createRemoteRunner({
      tools: {},
      executorUrl: "http://executor.local",
      runId: "run_456",
      callbackBaseUrl: "http://api.local",
      callbackToken: "token_456",
      fetchImpl: async () => {
        return new Response(JSON.stringify({ nope: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await runner.run("return 1;");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid response");
  });
});
