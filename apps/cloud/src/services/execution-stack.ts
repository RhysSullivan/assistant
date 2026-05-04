// ---------------------------------------------------------------------------
// Shared execution stack — the wiring that turns a request context into a
// runnable executor + engine. Used by the protected HTTP API (per-request)
// and the MCP session DO (per-session) so changes flow to both.
// ---------------------------------------------------------------------------

import { env } from "cloudflare:workers";
import { Effect } from "effect";

import { createExecutionEngine } from "@executor-js/execution";
import { makeDynamicWorkerExecutor } from "@executor-js/runtime-dynamic-worker";

import { withExecutionUsageTracking } from "../api/execution-usage";
import { AutumnService } from "./autumn";
import {
  createGlobalExecutor,
  createWorkspaceExecutor,
} from "./executor";
import type {
  GlobalContext,
  WorkspaceContext,
} from "./scope-stack";

const buildExecutor = (ctx: GlobalContext | WorkspaceContext) =>
  "workspaceId" in ctx
    ? createWorkspaceExecutor(ctx)
    : createGlobalExecutor(ctx);

export const makeExecutionStack = (ctx: GlobalContext | WorkspaceContext) =>
  Effect.gen(function* () {
    const executor = yield* buildExecutor(ctx).pipe(
      Effect.withSpan("McpSessionDO.createExecutor"),
    );
    const codeExecutor = makeDynamicWorkerExecutor({ loader: env.LOADER });
    const autumn = yield* AutumnService;
    const engine = withExecutionUsageTracking(
      ctx.organizationId,
      createExecutionEngine({ executor, codeExecutor }),
      (orgId) => Effect.runFork(autumn.trackExecution(orgId)),
    );
    return { executor, engine };
  }).pipe(Effect.withSpan("McpSessionDO.makeExecutionStack"));
