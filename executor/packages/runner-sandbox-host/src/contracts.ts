import { z } from "zod";

export const runRequestSchema = z.object({
  taskId: z.string().min(1),
  code: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  callback: z.object({
    convexUrl: z.string().min(1),
    internalSecret: z.string().min(1),
  }),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

export const runResultSchema = z.object({
  status: z.enum(["completed", "failed", "timed_out", "denied"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
  exitCode: z.number().optional(),
});

export type RunResult = z.infer<typeof runResultSchema>;

export const bridgePropsSchema = z.object({
  callbackConvexUrl: z.string(),
  callbackInternalSecret: z.string(),
  taskId: z.string(),
});

export type BridgeProps = z.infer<typeof bridgePropsSchema>;
