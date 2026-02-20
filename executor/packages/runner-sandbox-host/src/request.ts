import { runRequestSchema, type RunRequest } from "./contracts";

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
