import { Effect } from "effect";
import type { Executor, ToolId, ToolMetadata, ToolSchema, InvokeOptions } from "@executor/sdk";
import type { SandboxToolInvoker } from "@executor/codemode-core";

/**
 * Bridges QuickJS `tools.someSource.someOp(args)` calls into
 * `executor.tools.invoke(toolId, args)`.
 */
export const makeExecutorToolInvoker = (
  executor: Executor,
  options: { readonly invokeOptions: InvokeOptions },
): SandboxToolInvoker => ({
  invoke: ({ path, args }) =>
    Effect.gen(function* () {
      const result = yield* executor.tools.invoke(
        path as ToolId,
        args,
        options.invokeOptions,
      ).pipe(
        Effect.catchTag("ElicitationDeclinedError", (err) =>
          Effect.fail(
            new Error(
              `Tool "${err.toolId}" requires approval but the request was ${err.action === "cancel" ? "cancelled" : "declined"} by the user.`,
            ),
          ),
        ),
      );
      if (result.error !== null && result.error !== undefined) {
        return yield* Effect.fail(result.error);
      }
      return result.data;
    }),
});

/** What `tools.discover()` calls inside the sandbox. */
export const discoverTools = (
  executor: Executor,
  query: string,
  limit = 12,
): Effect.Effect<
  ReadonlyArray<{ path: string; name: string; description?: string; sourceId: string }>
> =>
  Effect.gen(function* () {
    const all = yield* executor.tools.list({ query });
    return all.slice(0, limit).map((t: ToolMetadata) => ({
      path: t.id,
      name: t.name,
      description: t.description,
      sourceId: t.sourceId,
    }));
  });

/** What `tools.describe.tool()` calls inside the sandbox. */
export const describeTool = (
  executor: Executor,
  path: string,
): Effect.Effect<
  { path: string; name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown },
  unknown
> =>
  Effect.gen(function* () {
    const schema: ToolSchema = yield* executor.tools.schema(path);
    const metadata = (yield* executor.tools.list()).find(
      (t: ToolMetadata) => t.id === path,
    );
    return {
      path,
      name: metadata?.name ?? path,
      description: metadata?.description,
      inputSchema: schema.inputSchema,
      outputSchema: schema.outputSchema,
    };
  });
