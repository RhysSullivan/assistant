import type { ToolDefinition } from "./types";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export const DEFAULT_TOOLS: ToolDefinition[] = [
  {
    path: "utils.get_time",
    description: "Return current server time.",
    approval: "auto",
    source: "local",
    run: async () => ({
      iso: new Date().toISOString(),
      unix: Date.now(),
    }),
  },
  {
    path: "math.add",
    description: "Add two numbers.",
    approval: "auto",
    source: "local",
    run: async (input) => {
      const payload = asObject(input);
      const a = Number(payload.a ?? 0);
      const b = Number(payload.b ?? 0);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error("math.add expects numeric a and b");
      }
      return { result: a + b };
    },
  },
  {
    path: "admin.send_announcement",
    description: "Mock announcement sender that requires approval.",
    approval: "required",
    source: "local",
    run: async (input) => {
      const payload = asObject(input);
      const channel = String(payload.channel ?? "general");
      const message = String(payload.message ?? "");
      if (!message.trim()) {
        throw new Error("admin.send_announcement requires a non-empty message");
      }
      return {
        sent: true,
        channel,
        message,
      };
    },
  },
  {
    path: "admin.delete_data",
    description: "Mock destructive operation that requires approval.",
    approval: "required",
    source: "local",
    run: async (input) => {
      const payload = asObject(input);
      const key = String(payload.key ?? "");
      if (!key.trim()) {
        throw new Error("admin.delete_data requires key");
      }
      return {
        deleted: true,
        key,
      };
    },
  },
];
