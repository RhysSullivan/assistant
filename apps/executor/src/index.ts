/**
 * Executor service — runs untrusted generated TS/JS code in an isolated process.
 *
 * This service only executes code. Any tools.* invocation is proxied back to the
 * control plane via an authenticated callback.
 */

import {
  createRunner,
  defineTool,
  ToolDeniedError,
  type ToolTree,
} from "@openassistant/core";
import type {
  ExecutorInvokeResponse,
  ExecutorRunRequest,
  ExecutorToolManifestEntry,
} from "@openassistant/core/remote-runner";
import { z } from "zod";

const ExecuteSchema: z.ZodType<ExecutorRunRequest> = z.object({
  runId: z.string().min(1),
  code: z.string(),
  timeoutMs: z.number().int().positive(),
  callbackBaseUrl: z.string().url(),
  callbackToken: z.string().min(1),
  tools: z.array(z.object({
    toolPath: z.string().min(1),
    approval: z.union([z.literal("auto"), z.literal("required")]),
  })),
});

const InvokeResponseSchema: z.ZodType<ExecutorInvokeResponse> = z.object({
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: z.string().optional(),
  denied: z.boolean().optional(),
});

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function setToolPath(tree: Record<string, unknown>, entry: ExecutorToolManifestEntry, request: ExecutorRunRequest): void {
  const parts = entry.toolPath.split(".").filter(Boolean);
  if (parts.length === 0) return;

  let current = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i]!;
    const next = current[segment];
    if (!next || typeof next !== "object") {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const leaf = parts[parts.length - 1]!;
  current[leaf] = defineTool({
    description: `Remote callback tool: ${entry.toolPath}`,
    approval: "auto",
    args: z.any(),
    returns: z.any(),
    run: async (input: unknown) => {
      const callbackUrl = `${request.callbackBaseUrl.replace(/\/$/, "")}/internal/runs/${encodeURIComponent(request.runId)}/invoke`;
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${request.callbackToken}`,
        },
        body: JSON.stringify({
          toolPath: entry.toolPath,
          input,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tool callback failed: HTTP ${response.status}`);
      }

      const payload = await response.json();
      const parsed = InvokeResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(`Tool callback returned invalid payload: ${parsed.error.message}`);
      }

      if (parsed.data.denied) {
        throw new ToolDeniedError(parsed.data.error ?? "Tool call denied");
      }

      if (!parsed.data.ok) {
        throw new Error(parsed.data.error ?? "Tool callback failed");
      }

      return parsed.data.value;
    },
  });
}

function buildToolTree(request: ExecutorRunRequest): ToolTree {
  const root: Record<string, unknown> = {};
  for (const entry of request.tools) {
    setToolPath(root, entry, request);
  }
  return root as ToolTree;
}

const PORT = Number(process.env["PORT"] ?? 3001);

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/internal/execute") {
      const body = await request.json().catch(() => undefined);
      const parsed = ExecuteSchema.safeParse(body);
      if (!parsed.success) {
        return json(400, {
          ok: false,
          error: `Invalid execute payload: ${parsed.error.message}`,
        });
      }

      const toolTree = buildToolTree(parsed.data);
      const runner = createRunner({
        tools: toolTree,
        requestApproval: async () => "approved",
        timeoutMs: parsed.data.timeoutMs,
      });

      const result = await runner.run(parsed.data.code);
      return json(200, result);
    }

    return json(404, { ok: false, error: "Not found" });
  },
});

console.log(`OpenAssistant executor running at http://localhost:${PORT}`);
