import {
  makeCloudflareWorkerLoaderRuntimeAdapter,
  makeDenoSubprocessRuntimeAdapter,
  makeLocalInProcessRuntimeAdapter,
  makeRuntimeAdapterRegistry,
  makeToolProviderRegistry,
  ToolProviderRegistryService,
} from "@executor-v2/engine";
import {
  handleMcpHttpRequest,
  type ExecuteToolInput,
  type ExecuteToolResult,
} from "@executor-v2/mcp-gateway";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";

const port = Number(Bun.env.PORT ?? 8787);

const runtimeRegistry = makeRuntimeAdapterRegistry([
  makeLocalInProcessRuntimeAdapter(),
  makeDenoSubprocessRuntimeAdapter(),
  makeCloudflareWorkerLoaderRuntimeAdapter(),
]);

const toolRegistry = makeToolProviderRegistry([]);

const errorToText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
};

const executeTool = async (input: ExecuteToolInput): Promise<ExecuteToolResult> => {
  const result = await Effect.runPromise(
    Effect.either(
      runtimeRegistry
        .execute({
          runtimeKind: input.runtimeKind ?? "local-inproc",
          code: input.code,
          tools: [],
        })
        .pipe(Effect.provideService(ToolProviderRegistryService, toolRegistry)),
    ),
  );

  if (Either.isLeft(result)) {
    return {
      isError: true,
      error: errorToText(result.left),
    };
  }

  return {
    isError: false,
    output: result.right,
  };
};

const handleMcp = async (request: Request): Promise<Response> =>
  handleMcpHttpRequest(request, {
    target: "local",
    serverName: "executor-v2-pm",
    serverVersion: "0.0.0",
    execute: executeTool,
  });

const server = Bun.serve({
  port,
  routes: {
    "/healthz": {
      GET: () => Response.json({ ok: true, service: "pm" }, { status: 200 }),
    },
    "/mcp": {
      GET: handleMcp,
      POST: handleMcp,
      DELETE: handleMcp,
    },
    "/v1/mcp": {
      GET: handleMcp,
      POST: handleMcp,
      DELETE: handleMcp,
    },
  },
});

console.log(`executor-v2 PM listening on http://127.0.0.1:${server.port}`);
