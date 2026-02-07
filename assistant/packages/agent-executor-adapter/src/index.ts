export interface RunCodeRequest {
  code: string;
  timeoutMs?: number;
  runtimeId?: string;
}

export interface RunCodeResponse {
  taskId: string;
}

export async function runCode(
  executorBaseUrl: string,
  request: RunCodeRequest,
): Promise<RunCodeResponse> {
  const response = await fetch(`${executorBaseUrl.replace(/\/$/, "")}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Failed to create executor task: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { taskId: string };
  return { taskId: payload.taskId };
}

export function subscribeToTaskEvents(
  executorBaseUrl: string,
  taskId: string,
  onMessage: (eventType: string, data: unknown) => void,
): EventSource {
  const streamUrl = `${executorBaseUrl.replace(/\/$/, "")}/api/tasks/${encodeURIComponent(taskId)}/events`;
  const source = new EventSource(streamUrl);

  source.onmessage = (event) => {
    let data: unknown = event.data;
    try {
      data = JSON.parse(event.data);
    } catch {
      // Keep raw message if JSON parse fails.
    }
    onMessage("message", data);
  };

  source.addEventListener("task", (event) => {
    const message = event as MessageEvent<string>;
    onMessage("task", JSON.parse(message.data));
  });

  source.addEventListener("approval", (event) => {
    const message = event as MessageEvent<string>;
    onMessage("approval", JSON.parse(message.data));
  });

  return source;
}
