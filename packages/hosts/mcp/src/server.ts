import { Effect, Match, Option, Schema } from "effect";
import * as Cause from "effect/Cause";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  jsonSchemaValidator,
  JsonSchemaType,
  JsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation/types.js";
import { Validator } from "@cfworker/json-schema";
import { z } from "zod/v4";

import type {
  ElicitationResponse,
  ElicitationHandler,
  ElicitationContext,
  ElicitationRequest,
} from "@executor-js/sdk";
import type * as Tracer from "effect/Tracer";
import {
  createExecutionEngine,
  formatExecuteResult,
  formatPausedExecution,
  type ExecutionEngine,
  type ExecutionEngineConfig,
} from "@executor-js/execution";

// ---------------------------------------------------------------------------
// Workers-compatible JSON Schema validator (replaces Ajv which uses new Function())
// ---------------------------------------------------------------------------

class CfWorkerJsonSchemaValidator implements jsonSchemaValidator {
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const validator = new Validator(schema as Record<string, unknown>, "2020-12", false);
    return (input: unknown) => {
      const result = validator.validate(input);
      if (result.valid) {
        return { valid: true, data: input as T, errorMessage: undefined };
      }
      const errorMessage = result.errors.map((e) => `${e.instanceLocation}: ${e.error}`).join("; ");
      return { valid: false, data: undefined, errorMessage };
    };
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type SharedMcpServerConfig = {
  /**
   * Pre-built `execute` tool description. When provided, the factory skips
   * its internal `engine.getDescription` yield. Useful when the caller
   * wants to compute the description inside its own Effect tracer context
   * so sub-spans (`executor.sources.list`, `executor.tools.list`) nest as
   * children of the caller's root span.
   */
  readonly description?: string;
  /**
   * Parent span override for engine calls. The factory captures the
   * caller's context at construction time, but `Effect.runPromiseWith`
   * starts a fresh fiber per SDK callback — so the `currentSpan`
   * FiberRef resets to root unless explicitly anchored.
   *
   * Accepts either a fixed span (per-request McpServer instances) or a
   * getter (session-scoped instances that need to anchor each callback
   * under whichever request triggered it; see the Cloud DO).
   */
  readonly parentSpan?: Tracer.AnySpan | (() => Tracer.AnySpan | undefined);
  /**
   * Enable verbose MCP capability / elicitation debug logging.
   */
  readonly debug?: boolean;
};

export type ExecutorMcpServerConfig<E extends Cause.YieldableError = Cause.YieldableError> =
  | (ExecutionEngineConfig<E> & SharedMcpServerConfig)
  | ({ readonly engine: ExecutionEngine<E> } & SharedMcpServerConfig)
  | (ExecutionEngineConfig<E> & SharedMcpServerConfig & { readonly stateless: true })
  | ({ readonly engine: ExecutionEngine<E>; readonly stateless: true } & SharedMcpServerConfig);

// ---------------------------------------------------------------------------
// Elicitation bridge
// ---------------------------------------------------------------------------

const getElicitationSupport = (server: McpServer): { form: boolean; url: boolean } => {
  const capabilities = server.server.getClientCapabilities();
  if (capabilities === undefined || !capabilities.elicitation) return { form: false, url: false };
  const elicitation = capabilities.elicitation as Record<string, unknown>;
  return { form: Boolean(elicitation.form), url: Boolean(elicitation.url) };
};

const readDebugDefault = (): boolean => {
  if (typeof process === "undefined" || !process.env) return false;
  const value = process.env.EXECUTOR_MCP_DEBUG;
  return value === "1" || value === "true";
};

const supportsManagedElicitation = (server: McpServer): boolean =>
  getElicitationSupport(server).form;

const capabilitySnapshot = (server: McpServer) => ({
  clientCapabilities: server.server.getClientCapabilities() ?? null,
  elicitationSupport: getElicitationSupport(server),
  managedElicitation: supportsManagedElicitation(server),
});

type ElicitInputParams =
  | {
      mode?: "form";
      message: string;
      requestedSchema: { readonly [key: string]: unknown };
    }
  | { mode: "url"; message: string; url: string; elicitationId: string };

type ElicitationRequestSnapshot = {
  readonly requestTag: "FormElicitation" | "UrlElicitation";
  readonly message: string;
  readonly hasRequestedSchema: boolean;
  readonly url?: string;
};

const elicitationRequestSnapshot: (request: ElicitationRequest) => ElicitationRequestSnapshot =
  Match.type<ElicitationRequest>().pipe(
    Match.tag("UrlElicitation", (req) => ({
      requestTag: "UrlElicitation" as const,
      message: req.message,
      hasRequestedSchema: false,
      url: req.url,
    })),
    Match.tag("FormElicitation", (req) => ({
      requestTag: "FormElicitation" as const,
      message: req.message,
      hasRequestedSchema: Object.keys(req.requestedSchema).length > 0,
    })),
    Match.exhaustive,
  );

const elicitationRequestToParams: (request: ElicitationRequest) => ElicitInputParams =
  Match.type<ElicitationRequest>().pipe(
    Match.tag("UrlElicitation", (req) => ({
      mode: "url" as const,
      message: req.message,
      url: req.url,
      elicitationId: req.elicitationId,
    })),
    Match.tag("FormElicitation", (req) => ({
      message: req.message,
      // The MCP SDK validates requestedSchema as a JSON Schema with
      // `type: "object"` and `properties`. For approval-only elicitations
      // where no fields are needed, provide a minimal valid schema.
      requestedSchema:
        Object.keys(req.requestedSchema).length === 0
          ? { type: "object" as const, properties: {} }
          : req.requestedSchema,
    })),
    Match.exhaustive,
  );

const elicitationRequestFallbackParams: (
  request: ElicitationRequest,
  supportsUrl: boolean,
) => ElicitInputParams = (request, supportsUrl) =>
  Match.value(request).pipe(
    Match.tag("UrlElicitation", (req) =>
      supportsUrl
        ? elicitationRequestToParams(req)
        : {
            message: `${req.message}\n\nPlease visit this URL:\n${req.url}\n\nClick accept once you have completed the flow.`,
            requestedSchema: { type: "object" as const, properties: {} },
          },
    ),
    Match.tag("FormElicitation", (req) => elicitationRequestToParams(req)),
    Match.exhaustive,
  );

type BoundaryErrorLog = {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
};

const formatBoundaryError = (error: unknown): BoundaryErrorLog => {
  // oxlint-disable-next-line executor/no-instanceof-error, executor/no-unknown-error-message, executor/no-unknown-error-stack, executor/no-unknown-error-name -- boundary: MCP SDK promise rejection is unknown and normalized into a stable debug/log payload
  if (error instanceof Error)
    // oxlint-disable-next-line executor/no-unknown-error-message, executor/no-unknown-error-stack, executor/no-unknown-error-name -- boundary: MCP SDK promise rejection is unknown and normalized into a stable debug/log payload
    return { name: error.name, message: error.message, stack: error.stack };
  // oxlint-disable-next-line executor/no-unknown-error-message -- boundary: MCP SDK promise rejection is unknown and normalized into a stable debug/log payload
  return { message: String(error) };
};

const interactionKind = (request: ElicitationRequest): ElicitationRequestSnapshot["requestTag"] =>
  elicitationRequestSnapshot(request).requestTag;

const makeMcpElicitationHandler =
  (
    server: McpServer,
    debugLog?: (event: string, data: Record<string, unknown>) => void,
  ): ElicitationHandler =>
  (ctx: ElicitationContext): Effect.Effect<typeof ElicitationResponse.Type> => {
    const { url: supportsUrl } = getElicitationSupport(server);
    const requestSnapshot = elicitationRequestSnapshot(ctx.request);
    const params = elicitationRequestFallbackParams(ctx.request, supportsUrl);

    return Effect.tryPromise({
      try: async (): Promise<typeof ElicitationResponse.Type> => {
        debugLog?.("elicitation.request", {
          requestTag: requestSnapshot.requestTag,
          supportsUrl,
          message: requestSnapshot.message,
          hasRequestedSchema: requestSnapshot.hasRequestedSchema,
          url: requestSnapshot.url,
          clientCapabilities: server.server.getClientCapabilities() ?? null,
        });
        const response = await server.server.elicitInput(
          params as Parameters<typeof server.server.elicitInput>[0],
        );

        debugLog?.("elicitation.response", {
          requestTag: requestSnapshot.requestTag,
          action: response.action,
          hasContent:
            typeof response.content === "object" &&
            response.content !== null &&
            Object.keys(response.content).length > 0,
        });

        return {
          action: response.action as typeof ElicitationResponse.Type.action,
          content: response.content,
        };
      },
      catch: formatBoundaryError,
    }).pipe(
      Effect.catch((boundaryLog: BoundaryErrorLog) =>
        Effect.sync(() => {
          debugLog?.("elicitation.error", {
            requestTag: requestSnapshot.requestTag,
            error: boundaryLog,
            clientCapabilities: server.server.getClientCapabilities() ?? null,
          });
          console.error(
            "[executor] elicitInput failed — falling back to cancel.",
            JSON.stringify({
              error: boundaryLog.message,
              requestTag: requestSnapshot.requestTag,
              ...capabilitySnapshot(server),
            }),
          );
          return { action: "cancel" as const } as ElicitationResponse;
        }),
      ),
    );
  };

// ---------------------------------------------------------------------------
// MCP result formatting
// ---------------------------------------------------------------------------

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const toMcpResult = (formatted: ReturnType<typeof formatExecuteResult>): McpToolResult => ({
  content: [{ type: "text", text: formatted.text }],
  structuredContent: formatted.structured,
  isError: formatted.isError || undefined,
});

const toMcpPausedResult = (formatted: ReturnType<typeof formatPausedExecution>): McpToolResult => ({
  content: [{ type: "text", text: formatted.text }],
  structuredContent: formatted.structured,
});

const FailureMessageValue = Schema.Union([
  Schema.NonEmptyString,
  Schema.Struct({ message: Schema.NonEmptyString }),
]);

const formatFailureMessage = (value: unknown): string | null =>
  Schema.decodeUnknownOption(FailureMessageValue)(value).pipe(
    Option.map((parsed) => (typeof parsed === "string" ? parsed : parsed.message)),
    Option.getOrNull,
  );

const toMcpFailureResult = (cause: Cause.Cause<unknown>): McpToolResult => {
  const failure = cause.reasons.find(Cause.isFailReason);
  const text = failure
    ? (formatFailureMessage(failure.error) ?? "Tool execution failed")
    : "Tool execution failed";
  return {
    content: [{ type: "text", text: `Error: ${text}` }],
    structuredContent: { status: "error", error: text },
    isError: true,
  };
};

const JsonObjectContent = Schema.Record(Schema.String, Schema.Unknown);
const decodeJsonObjectContent = Schema.decodeUnknownOption(JsonObjectContent);

const parseJsonContent = (raw: string): Record<string, unknown> | undefined => {
  if (raw === "{}") return undefined;
  return Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(raw).pipe(
    Option.flatMap(decodeJsonObjectContent),
    Option.getOrUndefined,
  );
};

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export const createExecutorMcpServer = <E extends Cause.YieldableError>(
  config: ExecutorMcpServerConfig<E>,
): Effect.Effect<McpServer> =>
  Effect.gen(function* () {
    const engine = "engine" in config ? config.engine : createExecutionEngine(config);
    const description =
      config.description ??
      (yield* engine.getDescription.pipe(Effect.withSpan("mcp.host.get_description")));

    // Captured at construction time. SDK callbacks fire later (often
    // deferred past the outer Effect's await), so we use the runtime to
    // re-enter Effect-land at each callback edge.
    const context = yield* Effect.context<never>();
    const debugEnabled = config.debug ?? readDebugDefault();
    const debugLog = (event: string, data: Record<string, unknown>) => {
      if (!debugEnabled) return;
      // oxlint-disable-next-line executor/no-try-catch-or-throw -- boundary: debug logging must not fail MCP host callbacks if payload serialization throws
      try {
        console.error(`[executor:mcp] ${event} ${JSON.stringify(data)}`);
      } catch {
        console.error(`[executor:mcp] ${event}`, data);
      }
    };

    const resolveParentSpan = (): Tracer.AnySpan | undefined => {
      const ps = config.parentSpan;
      return typeof ps === "function" ? ps() : ps;
    };
    const anchor = <A, EffE>(effect: Effect.Effect<A, EffE>): Effect.Effect<A, EffE> => {
      const parent = resolveParentSpan();
      return parent ? Effect.withParentSpan(effect, parent) : effect;
    };
    const runToolEffect = <EffE>(effect: Effect.Effect<McpToolResult, EffE>) =>
      Effect.runPromiseWith(context)(
        anchor(effect).pipe(
          Effect.catchCause((cause) => Effect.succeed(toMcpFailureResult(cause))),
        ),
      );

    const server = yield* Effect.sync(
      () =>
        new McpServer(
          { name: "executor", version: "1.0.0" },
          {
            capabilities: { tools: {} },
            jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
          },
        ),
    ).pipe(Effect.withSpan("mcp.host.create_server"));

    const executeCode = (code: string): Effect.Effect<McpToolResult, E> =>
      Effect.gen(function* () {
        debugLog("execute.call", {
          managedElicitation: supportsManagedElicitation(server),
          elicitationSupport: getElicitationSupport(server),
          clientCapabilities: server.server.getClientCapabilities() ?? null,
          codeLength: code.length,
        });
        if (supportsManagedElicitation(server)) {
          const result = yield* engine.execute(code, {
            onElicitation: makeMcpElicitationHandler(server, debugLog),
          });
          return toMcpResult(formatExecuteResult(result));
        }
        const outcome = yield* engine.executeWithPause(code);
        debugLog("execute.paused_flow_result", {
          status: outcome.status,
          executionId: outcome.status === "paused" ? outcome.execution.id : undefined,
          interactionKind:
            outcome.status === "paused"
              ? interactionKind(outcome.execution.elicitationContext.request)
              : undefined,
        });
        return outcome.status === "completed"
          ? toMcpResult(formatExecuteResult(outcome.result))
          : toMcpPausedResult(formatPausedExecution(outcome.execution));
      }).pipe(
        Effect.withSpan("mcp.host.tool.execute", {
          attributes: {
            "mcp.tool.name": "execute",
            "mcp.execute.code_length": code.length,
          },
        }),
      );

    const resumeExecution = (
      executionId: string,
      action: "accept" | "decline" | "cancel",
      content: Record<string, unknown> | undefined,
    ): Effect.Effect<McpToolResult, E> =>
      Effect.gen(function* () {
        debugLog("resume.call", {
          executionId,
          action,
          hasContent: content !== undefined,
          clientCapabilities: server.server.getClientCapabilities() ?? null,
        });
        const outcome = yield* engine.resume(executionId, { action, content });
        if (!outcome) {
          debugLog("resume.missing_execution", { executionId });
          return {
            content: [{ type: "text" as const, text: `No paused execution: ${executionId}` }],
            isError: true,
          } satisfies McpToolResult;
        }
        debugLog("resume.result", {
          executionId,
          status: outcome.status,
          nextExecutionId: outcome.status === "paused" ? outcome.execution.id : undefined,
          interactionKind:
            outcome.status === "paused"
              ? interactionKind(outcome.execution.elicitationContext.request)
              : undefined,
        });
        return outcome.status === "completed"
          ? toMcpResult(formatExecuteResult(outcome.result))
          : toMcpPausedResult(formatPausedExecution(outcome.execution));
      }).pipe(
        Effect.withSpan("mcp.host.tool.resume", {
          attributes: {
            "mcp.tool.name": "resume",
            "mcp.execute.resume.action": action,
            "mcp.execute.execution_id": executionId,
          },
        }),
      );

    // --- tools ---

    const executeTool = yield* Effect.sync(() =>
      server.registerTool(
        "execute",
        {
          description,
          inputSchema: { code: z.string().trim().min(1) },
        },
        ({ code }) => runToolEffect(executeCode(code)),
      ),
    ).pipe(
      Effect.withSpan("mcp.host.register_tool", {
        attributes: { "mcp.tool.name": "execute" },
      }),
    );

    const resumeTool = yield* Effect.sync(() =>
      server.registerTool(
        "resume",
        {
          description: [
            "Resume a paused execution using the executionId returned by execute.",
            "Never call this without user approval unless they explicitly state otherwise.",
          ].join("\n"),
          inputSchema: {
            executionId: z.string().describe("The execution ID from the paused result"),
            action: z
              .enum(["accept", "decline", "cancel"])
              .describe("How to respond to the interaction"),
            content: z
              .string()
              .describe("Optional JSON-encoded response content for form elicitations")
              .default("{}"),
          },
        },
        ({ executionId, action, content: rawContent }) =>
          runToolEffect(resumeExecution(executionId, action, parseJsonContent(rawContent))),
      ),
    ).pipe(
      Effect.withSpan("mcp.host.register_tool", {
        attributes: { "mcp.tool.name": "resume" },
      }),
    );

    // --- capability-based tool visibility ---

    const syncToolAvailability = () => {
      executeTool.enable();
      if (supportsManagedElicitation(server)) {
        resumeTool.disable();
      } else {
        resumeTool.enable();
      }
      console.error(
        "[executor] MCP capability snapshot",
        JSON.stringify({
          ...capabilitySnapshot(server),
          resumeEnabled: !supportsManagedElicitation(server),
        }),
      );
      debugLog("tool.visibility", {
        clientCapabilities: server.server.getClientCapabilities() ?? null,
        elicitationSupport: getElicitationSupport(server),
        managedElicitation: supportsManagedElicitation(server),
        resumeEnabled: !supportsManagedElicitation(server),
      });
    };

    yield* Effect.sync(() => {
      syncToolAvailability();
      server.server.oninitialized = syncToolAvailability;
    }).pipe(Effect.withSpan("mcp.host.sync_tool_availability"));

    return server;
  }).pipe(Effect.withSpan("mcp.host.create_executor_server"));
