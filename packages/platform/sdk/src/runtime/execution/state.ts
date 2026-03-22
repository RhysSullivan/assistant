import type {
  CodeExecutor,
  OnElicitation,
  ToolCatalog,
  ToolInvoker,
} from "@executor/codemode-core";
import type {
  ScopeId,
  ExecutionId,
} from "#schema";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export type ExecutionEnvironment = {
  executor: CodeExecutor;
  toolInvoker: ToolInvoker;
  catalog?: ToolCatalog;
};

export type ResolveExecutionEnvironment = (input: {
  scopeId: ScopeId;
  actorScopeId: ScopeId;
  executionId: ExecutionId;
  onElicitation?: OnElicitation;
}) => Effect.Effect<ExecutionEnvironment, unknown>;

export class ResumeUnsupportedError extends Data.TaggedError(
  "ResumeUnsupportedError",
)<{
  executionId: ExecutionId;
}> {}
