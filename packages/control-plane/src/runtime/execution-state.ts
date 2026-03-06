import type {
  CodeExecutor,
  OnElicitation,
  ToolCatalog,
  ToolInvoker,
} from "@executor-v3/codemode-core";
import type { AccountId, ExecutionId, WorkspaceId } from "#schema";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export type ExecutionEnvironment = {
  executor: CodeExecutor;
  toolInvoker: ToolInvoker;
  catalog?: ToolCatalog;
};

export type ResolveExecutionEnvironment = (input: {
  workspaceId: WorkspaceId;
  accountId: AccountId;
  executionId: ExecutionId;
  onElicitation?: OnElicitation;
}) => Effect.Effect<ExecutionEnvironment, unknown>;

export class ResumeUnsupportedError extends Data.TaggedError(
  "ResumeUnsupportedError",
)<{
  executionId: ExecutionId;
}> {}
