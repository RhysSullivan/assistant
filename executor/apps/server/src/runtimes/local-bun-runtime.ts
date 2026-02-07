import { runCodeWithAdapter } from "./runtime-core";
import type {
  ExecutionAdapter,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxRuntime,
} from "../types";

export class LocalBunRuntime implements SandboxRuntime {
  readonly id = "local-bun";
  readonly label = "Local JS Runtime";
  readonly description = "Runs generated JavaScript in-process with pluggable execution adapter.";

  async run(
    request: SandboxExecutionRequest,
    adapter: ExecutionAdapter,
  ): Promise<SandboxExecutionResult> {
    return await runCodeWithAdapter(request, adapter);
  }
}
