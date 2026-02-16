import { z } from "zod";
import type { RunRequest } from "./types";

const runRequestSchema: z.ZodType<RunRequest> = z.object({
  taskId: z.string().min(1),
  code: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  callback: z.object({
    convexUrl: z.string().min(1),
    internalSecret: z.string().min(1),
  }),
});

export async function parseRunRequest(request: Request): Promise<RunRequest | Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = runRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return Response.json(
      { error: "Missing required fields: taskId, code, callback.convexUrl, callback.internalSecret" },
      { status: 400 },
    );
  }

  return body.data;
}
