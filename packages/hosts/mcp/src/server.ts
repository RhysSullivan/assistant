import { Effect, Match, Runtime } from "effect";
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
} from "@executor/sdk";
import type * as Cause from "effect/Cause";
import type * as Tracer from "effect/Tracer";
import {
  createExecutionEngine,
  formatExecuteResult,
  formatPausedExecution,
  type ExecutionEngine,
  type ExecutionEngineConfig,
} from "@executor/execution";

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
   * caller's `Runtime` at construction time, but `Runtime.runPromise`
   * starts a fresh fiber per SDK callback — so the `currentSpan`
   * FiberRef resets to root unless explicitly anchored.
   *
   * Accepts either a fixed span (per-request McpServer instances) or a
   * getter (session-scoped instances that need to anchor each callback
   * under whichever request triggered it; see the Cloud DO).
   */
  readonly parentSpan?: Tracer.AnySpan | (() => Tracer.AnySpan | undefined);
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

const supportsManagedElicitation = (server: McpServer): boolean =>
  getElicitationSupport(server).form;

type ElicitInputParams =
  | {
      mode?: "form";
      message: string;
      requestedSchema: { readonly [key: string]: unknown };
    }
  | { mode: "url"; message: string; url: string; elicitationId: string };

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

const makeMcpElicitationHandler =
  (server: McpServer): ElicitationHandler =>
  (ctx: ElicitationContext): Effect.Effect<typeof ElicitationResponse.Type> => {
    const { url: supportsUrl } = getElicitationSupport(server);

    // If client doesn't support url mode, fall back to a form asking the user
    // to visit the URL manually and confirm when done.
    const params =
      ctx.request._tag === "UrlElicitation" && !supportsUrl
        ? {
            message: `${ctx.request.message}\n\nPlease visit this URL:\n${ctx.request.url}\n\nClick accept once you have completed the flow.`,
            requestedSchema: { type: "object" as const, properties: {} },
          }
        : elicitationRequestToParams(ctx.request);

    return Effect.promise(async (): Promise<typeof ElicitationResponse.Type> => {
      try {
        const response = await server.server.elicitInput(
          params as Parameters<typeof server.server.elicitInput>[0],
        );

        return {
          action: response.action,
          content: response.content,
        };
      } catch (err) {
        console.error(
          "[executor] elicitInput failed — falling back to cancel.",
          err instanceof Error ? err.message : err,
        );
        return { action: "cancel" };
      }
    });
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

const parseJsonContent = (raw: string): Record<string, unknown> | undefined => {
  if (raw === "{}") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
};

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export const createExecutorMcpServer = <E extends Cause.YieldableError>(
  config: ExecutorMcpServerConfig<E>,
): Effect.Effect<McpServer> =>
  Effect.gen(function* () {
    const engine = "engine" in config ? config.engine : createExecutionEngine(config);
    const description = config.description ?? (yield* engine.getDescription);

    // Captured at construction time. SDK callbacks fire later (often
    // deferred past the outer Effect's await), so we use the runtime to
    // re-enter Effect-land at each callback edge.
    const runtime = yield* Effect.runtime<never>();

    const resolveParentSpan = (): Tracer.AnySpan | undefined => {
      const ps = config.parentSpan;
      return typeof ps === "function" ? ps() : ps;
    };
    const anchor = <A, EffE>(effect: Effect.Effect<A, EffE>): Effect.Effect<A, EffE> => {
      const parent = resolveParentSpan();
      return parent ? Effect.withParentSpan(effect, parent) : effect;
    };

    const server = new McpServer(
      { name: "executor", version: "1.0.0" },
      { capabilities: { tools: {} }, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );

    const executeCode = (code: string): Effect.Effect<McpToolResult, E> =>
      Effect.gen(function* () {
        if (supportsManagedElicitation(server)) {
          const result = yield* engine.execute(code, {
            onElicitation: makeMcpElicitationHandler(server),
          });
          return toMcpResult(formatExecuteResult(result));
        }
        const outcome = yield* engine.executeWithPause(code);
        return outcome.status === "completed"
          ? toMcpResult(formatExecuteResult(outcome.result))
          : toMcpPausedResult(formatPausedExecution(outcome.execution));
      });

    const resumeExecution = (
      executionId: string,
      action: "accept" | "decline" | "cancel",
      content: Record<string, unknown> | undefined,
    ): Effect.Effect<McpToolResult, E> =>
      Effect.gen(function* () {
        const outcome = yield* engine.resume(executionId, { action, content });
        if (!outcome) {
          return {
            content: [{ type: "text", text: `No paused execution: ${executionId}` }],
            isError: true,
          };
        }
        return outcome.status === "completed"
          ? toMcpResult(formatExecuteResult(outcome.result))
          : toMcpPausedResult(formatPausedExecution(outcome.execution));
      });

    // --- tools ---

    const executeTool = server.registerTool(
      "execute",
      {
        description,
        inputSchema: { code: z.string().trim().min(1) },
      },
      ({ code }) => Runtime.runPromise(runtime)(anchor(executeCode(code))),
    );

    const resumeTool = server.registerTool(
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
        Runtime.runPromise(runtime)(
          anchor(resumeExecution(executionId, action, parseJsonContent(rawContent))),
        ),
    );

    // --- capability-based tool visibility ---

    const syncToolAvailability = () => {
      executeTool.enable();
      if (supportsManagedElicitation(server)) {
        resumeTool.disable();
      } else {
        resumeTool.enable();
      }
    };

    syncToolAvailability();
    server.server.oninitialized = syncToolAvailability;

    return server;
  });
