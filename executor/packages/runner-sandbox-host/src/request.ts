import { Result } from "better-result";
import type { RunRequest } from "./types";

export async function parseRunRequest(request: Request): Promise<RunRequest | Response> {
  const parsed = await Result.tryPromise(() => request.json() as Promise<RunRequest>);
  if (parsed.isErr()) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = parsed.value;
  if (!body.taskId || !body.code || !body.callback?.convexUrl || !body.callback?.internalSecret) {
    return Response.json(
      { error: "Missing required fields: taskId, code, callback.convexUrl, callback.internalSecret" },
      { status: 400 },
    );
  }

  return body;
}
