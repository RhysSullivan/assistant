import { Command, Options, Args } from "@effect/cli";
import { BunRuntime } from "@effect/platform-bun";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";

import {
  createServerHandlers,
  runMcpStdioServer,
  getExecutor,
} from "@executor/server";
import {
  createExecutionEngine,
  formatExecuteResult,
  formatPausedExecution,
} from "@executor/execution";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLI_NAME = "executor";
const { version: CLI_VERSION } = await import("../package.json");
const DEFAULT_PORT = 8788;

// Embedded web UI — baked into compiled binaries via `with { type: "file" }`
const embeddedWebUI: Record<string, string> | null =
  await import("embedded-web-ui.gen.ts")
    .then((m) => m.default as Record<string, string>)
    .catch(() => null);

// Boot executor + execution engine eagerly so `call` description is dynamic
const executor = await getExecutor();
const engine = createExecutionEngine({ executor });
const callDescription = `\n<call description start>\n${await engine.getDescription()}\n<call description end>`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const waitForShutdownSignal = () =>
  Effect.async<void, never>((resume) => {
    const shutdown = () => resume(Effect.void);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return Effect.sync(() => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    });
  });

const appendUrlPath = (baseUrl: string, pathname: string): string =>
  new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

const renderSessionSummary = (kind: "web" | "mcp", baseUrl: string): string => {
  const displayKind = kind === "mcp" ? "MCP" : "web";
  const primaryLabel = kind === "web" ? "Web" : "MCP";
  const primaryUrl = kind === "web" ? baseUrl : appendUrlPath(baseUrl, "mcp");
  const secondaryLabel = kind === "web" ? "MCP" : "Web";
  const secondaryUrl = kind === "web" ? appendUrlPath(baseUrl, "mcp") : baseUrl;
  const guidance =
    kind === "web"
      ? "Keep this process running while you use the browser session."
      : "Use this MCP URL in your client and keep this process running.";

  return [
    `Executor ${displayKind} session is ready.`,
    `${primaryLabel}: ${primaryUrl}`,
    `${secondaryLabel}: ${secondaryUrl}`,
    `OpenAPI: ${appendUrlPath(baseUrl, "docs")}`,
    "",
    guidance,
    "Press Ctrl+C to stop.",
  ].join("\n");
};

// ---------------------------------------------------------------------------
// Static file serving from embedded web UI
// ---------------------------------------------------------------------------

const serveStatic = async (pathname: string): Promise<Response | null> => {
  if (!embeddedWebUI) return null;

  const key = pathname.replace(/^\//, "");
  const match = embeddedWebUI[key] ?? embeddedWebUI["index.html"] ?? null;
  if (!match) return null;

  const file = Bun.file(match);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "content-type": file.type || "application/octet-stream" },
    });
  }
  return null;
};

// ---------------------------------------------------------------------------
// Foreground session — API + MCP + Web UI on one Bun.serve()
// ---------------------------------------------------------------------------

const runForegroundSession = (input: { kind: "web" | "mcp"; port: number }) =>
  Effect.gen(function* () {
    const handlers = yield* Effect.promise(() => createServerHandlers());

    const server = Bun.serve({
      port: input.port,
      async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/mcp")) {
          return handlers.mcp.handleRequest(request);
        }

        if (
          url.pathname.startsWith("/v1/") ||
          url.pathname.startsWith("/docs") ||
          url.pathname === "/openapi.json"
        ) {
          return handlers.api.handler(request);
        }

        const staticResponse = await serveStatic(url.pathname);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
      },
    });

    const baseUrl = `http://localhost:${server.port}`;
    console.log(renderSessionSummary(input.kind, baseUrl));

    yield* waitForShutdownSignal();

    server.stop(true);
    yield* Effect.promise(() => handlers.mcp.close());
    yield* Effect.promise(() => handlers.api.dispose());
  });

// ---------------------------------------------------------------------------
// Stdio MCP session
// ---------------------------------------------------------------------------

const runStdioMcpSession = () =>
  Effect.promise(() => runMcpStdioServer({ executor }));

// ---------------------------------------------------------------------------
// Code resolution — positional arg > --file > stdin
// ---------------------------------------------------------------------------

const readCode = (input: {
  code: Option.Option<string>;
  file: Option.Option<string>;
  stdin: boolean;
}): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const code = Option.getOrUndefined(input.code);
    if (code && code.trim().length > 0) return code;

    const file = Option.getOrUndefined(input.file);
    if (file && file.trim().length > 0) {
      const contents = yield* Effect.tryPromise({
        try: () => Bun.file(file).text(),
        catch: (e) => new Error(`Failed to read file: ${e}`),
      });
      if (contents.trim().length > 0) return contents;
    }

    if (input.stdin || !process.stdin.isTTY) {
      const chunks: string[] = [];
      process.stdin.setEncoding("utf8");
      const contents = yield* Effect.tryPromise({
        try: async () => {
          for await (const chunk of process.stdin) chunks.push(chunk as string);
          return chunks.join("");
        },
        catch: (e) => new Error(`Failed to read stdin: ${e}`),
      });
      if (contents.trim().length > 0) return contents;
    }

    return yield* Effect.fail(
      new Error(
        "No code provided. Pass code as an argument, --file, or pipe to stdin.",
      ),
    );
  });

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const callCommand = Command.make(
  "call",
  {
    code: Args.text({ name: "code" }).pipe(Args.optional),
    file: Options.text("file").pipe(Options.optional),
    stdin: Options.boolean("stdin").pipe(Options.withDefault(false)),
  },
  ({ code, file, stdin }) =>
    Effect.gen(function* () {
      const resolvedCode = yield* readCode({ code, file, stdin }).pipe(
        Effect.mapError((e) => e),
      );

      const outcome = yield* Effect.promise(() =>
        engine.executeWithPause(resolvedCode),
      );

      if (outcome.status === "completed") {
        const formatted = formatExecuteResult(outcome.result);
        if (formatted.isError) {
          console.error(formatted.text);
          process.exitCode = 1;
        } else {
          console.log(formatted.text);
        }
      } else {
        const formatted = formatPausedExecution(outcome.execution);
        console.log(formatted.text);
      }
    }),
).pipe(Command.withDescription(callDescription));

const webCommand = Command.make(
  "web",
  {
    port: Options.integer("port").pipe(Options.withDefault(DEFAULT_PORT)),
  },
  ({ port }) => runForegroundSession({ kind: "web", port }),
).pipe(Command.withDescription("Start a foreground web session"));

const mcpCommand = Command.make(
  "mcp",
  {
    port: Options.integer("port").pipe(Options.withDefault(DEFAULT_PORT)),
    stdio: Options.boolean("stdio").pipe(Options.withDefault(false)),
    webPort: Options.integer("web-port").pipe(Options.optional),
  },
  ({ port, stdio, webPort }) =>
    stdio ? runStdioMcpSession() : runForegroundSession({ kind: "mcp", port }),
).pipe(
  Command.withDescription(
    "Start a foreground MCP session, or run stdio MCP with --stdio",
  ),
);

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

const root = Command.make("executor").pipe(
  Command.withSubcommands([callCommand, webCommand, mcpCommand] as const),
  Command.withDescription("Executor local CLI"),
);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const runCli = Command.run(root, {
  name: CLI_NAME,
  version: CLI_VERSION,
  executable: CLI_NAME,
});

const program = runCli(process.argv).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      console.error(Cause.pretty(cause));
      process.exitCode = 1;
    }),
  ),
);

BunRuntime.runMain(program as Effect.Effect<void, never, never>);
