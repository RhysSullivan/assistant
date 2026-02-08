import { APPROVAL_DENIED_PREFIX } from "../execution_constants";
import type { Id } from "../../_generated/dataModel";
import type {
  ExecutionAdapter,
  RuntimeOutputEvent,
  ToolCallRequest,
  ToolCallResult,
} from "../types";
import { describeError } from "../utils";

interface InProcessExecutionAdapterOptions {
  runId: Id<"tasks">;
  invokeTool: (call: ToolCallRequest) => Promise<unknown>;
  emitOutput: (event: RuntimeOutputEvent) => void;
}

export class InProcessExecutionAdapter implements ExecutionAdapter {
  constructor(private readonly options: InProcessExecutionAdapterOptions) {}

  async invokeTool(call: ToolCallRequest): Promise<ToolCallResult> {
    if (call.runId !== this.options.runId) {
      return {
        ok: false,
        error: `Run mismatch for call ${call.callId}`,
      };
    }

    try {
      const value = await this.options.invokeTool(call);
      return { ok: true, value };
    } catch (error) {
      const message = describeError(error);
      if (message.startsWith(APPROVAL_DENIED_PREFIX)) {
        return {
          ok: false,
          denied: true,
          error: message.replace(APPROVAL_DENIED_PREFIX, "").trim(),
        };
      }

      return {
        ok: false,
        error: message,
      };
    }
  }

  emitOutput(event: RuntimeOutputEvent): void {
    if (event.runId !== this.options.runId) {
      return;
    }
    this.options.emitOutput(event);
  }
}
