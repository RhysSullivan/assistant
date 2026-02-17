import { z } from "zod";
import type { ToolDefinition } from "../../../core/src/types";

const adminAnnouncementInputSchema = z.object({
  channel: z.string().optional(),
  message: z.string().optional(),
});

const payloadRecordSchema = z.record(z.unknown());

function toInputPayload(value: unknown): Record<string, unknown> {
  const parsed = payloadRecordSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return value === undefined ? {} : { value };
}

export const baseTools = new Map<string, ToolDefinition>();

// Minimal built-in tools used by tests/demos.
// These are intentionally simple and are always approval-gated.
baseTools.set("admin.send_announcement", {
  path: "admin.send_announcement",
  source: "system",
  approval: "required",
  description: "Send an announcement message (demo tool; approval-gated).",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        message: { type: "string" },
      },
      required: ["channel", "message"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        channel: { type: "string" },
        message: { type: "string" },
      },
      required: ["ok", "channel", "message"],
      additionalProperties: false,
    },
  },
  run: async (input: unknown) => {
    const parsedInput = adminAnnouncementInputSchema.safeParse(toInputPayload(input));
    const channel = parsedInput.success ? (parsedInput.data.channel ?? "") : "";
    const message = parsedInput.success ? (parsedInput.data.message ?? "") : "";
    return { ok: true, channel, message };
  },
});

baseTools.set("admin.delete_data", {
  path: "admin.delete_data",
  source: "system",
  approval: "required",
  description: "Delete data (demo tool; approval-gated).",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
      },
      required: ["ok"],
      additionalProperties: false,
    },
  },
  run: async () => {
    return { ok: true };
  },
});

// System tools (discover/catalog) are resolved server-side.
// Their execution is handled in the Convex tool invocation pipeline.
baseTools.set("discover", {
  path: "discover",
  source: "system",
  approval: "auto",
  description:
    "Search available tools by keyword. Returns preferred path aliases, signature hints, and ready-to-copy call examples. Compact mode is enabled by default.",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        depth: { type: "number" },
        limit: { type: "number" },
        compact: { type: "boolean" },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        bestPath: {},
        results: { type: "array" },
        total: { type: "number" },
      },
      required: ["bestPath", "results", "total"],
    },
  },
  run: async () => {
    throw new Error("discover is handled by the server tool invocation pipeline");
  },
});

baseTools.set("catalog.namespaces", {
  path: "catalog.namespaces",
  source: "system",
  approval: "auto",
  description: "List available tool namespaces with counts and sample callable paths.",
  typing: {
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        namespaces: { type: "array" },
        total: { type: "number" },
      },
      required: ["namespaces", "total"],
    },
  },
  run: async () => {
    throw new Error("catalog.namespaces is handled by the server tool invocation pipeline");
  },
});

baseTools.set("catalog.tools", {
  path: "catalog.tools",
  source: "system",
  approval: "auto",
  description: "List tools with typed signatures. Supports namespace and query filters in one call.",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        query: { type: "string" },
        depth: { type: "number" },
        limit: { type: "number" },
        compact: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        results: { type: "array" },
        total: { type: "number" },
      },
      required: ["results", "total"],
    },
  },
  run: async () => {
    throw new Error("catalog.tools is handled by the server tool invocation pipeline");
  },
});
