import type {
  ExecutionAdapter,
  RuntimeOutputEvent,
  ToolCallRequest,
  ToolCallResult,
} from "../types";

interface HttpExecutionAdapterOptions {
  controlPlaneBaseUrl: string;
  runId: string;
  token?: string;
}

function withBase(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export class HttpExecutionAdapter implements ExecutionAdapter {
  constructor(private readonly options: HttpExecutionAdapterOptions) {}

  private authHeaders(): Record<string, string> {
    if (!this.options.token) {
      return {};
    }
    return { authorization: `Bearer ${this.options.token}` };
  }

  async invokeTool(call: ToolCallRequest): Promise<ToolCallResult> {
    if (call.runId !== this.options.runId) {
      return {
        ok: false,
        error: `Run mismatch for call ${call.callId}`,
      };
    }

    const response = await fetch(
      withBase(this.options.controlPlaneBaseUrl, `/internal/runs/${encodeURIComponent(call.runId)}/tool-call`),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(call),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        error: `Tool call request failed (${response.status}): ${text}`,
      };
    }

    return (await response.json()) as ToolCallResult;
  }

  async emitOutput(event: RuntimeOutputEvent): Promise<void> {
    if (event.runId !== this.options.runId) {
      return;
    }

    await fetch(
      withBase(this.options.controlPlaneBaseUrl, `/internal/runs/${encodeURIComponent(event.runId)}/output`),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(event),
      },
    );
  }
}
