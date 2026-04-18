import * as Effect from "effect/Effect";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toToolPathSegments = (toolPath: string): ReadonlyArray<string> =>
  toolPath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const buildToolAccessExpression = (toolPath: string): string => {
  const segments = toToolPathSegments(toolPath);
  if (segments.length === 0) {
    throw new Error("Tool path must include at least one segment");
  }
  return segments.map((segment) => `[${JSON.stringify(segment)}]`).join("");
};

export const parseJsonObjectInput = (
  raw: string | undefined,
): Effect.Effect<Record<string, unknown>, Error> =>
  Effect.gen(function* () {
    if (raw === undefined || raw.trim().length === 0) {
      return {};
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) =>
        cause instanceof Error
          ? new Error(`Invalid --input JSON: ${cause.message}`)
          : new Error(`Invalid --input JSON: ${String(cause)}`),
    });

    if (!isRecord(parsed)) {
      return yield* Effect.fail(new Error("--input must decode to a JSON object"));
    }

    return parsed;
  });

export const extractExecutionResult = (structured: unknown): unknown => {
  if (!isRecord(structured) || !("result" in structured)) {
    return null;
  }
  return structured.result;
};

export const extractExecutionId = (structured: unknown): string | undefined => {
  if (!isRecord(structured) || typeof structured.executionId !== "string") {
    return undefined;
  }
  return structured.executionId;
};

export const buildSearchToolsCode = (input: {
  query: string;
  namespace?: string;
  limit: number;
}): string => {
  const payload: Record<string, unknown> = {
    query: input.query,
    limit: input.limit,
  };
  if (input.namespace && input.namespace.trim().length > 0) {
    payload.namespace = input.namespace;
  }
  return `return await tools.search(${JSON.stringify(payload)});`;
};

export const buildListSourcesCode = (input: { query?: string; limit: number }): string => {
  const payload: Record<string, unknown> = {
    limit: input.limit,
  };
  if (input.query && input.query.trim().length > 0) {
    payload.query = input.query;
  }
  return `return await tools.executor.sources.list(${JSON.stringify(payload)});`;
};

export const buildDescribeToolCode = (toolPath: string): string =>
  `return await tools.describe.tool({ path: ${JSON.stringify(toolPath)} });`;

export const buildInvokeToolCode = (toolPath: string, args: Record<string, unknown>): string => {
  const access = buildToolAccessExpression(toolPath);
  return [
    `const __toolPath = ${JSON.stringify(toolPath)};`,
    `const __args = ${JSON.stringify(args, null, 2)};`,
    `const __target = tools${access};`,
    `if (typeof __target !== "function") {`,
    "  throw new Error(`Tool not found: ${__toolPath}`);",
    "}",
    "return await __target(__args);",
  ].join("\n");
};

export const buildRunToolQueryCode = (input: {
  query: string;
  namespace?: string;
  args: Record<string, unknown>;
  limit: number;
}): string => {
  const payload: Record<string, unknown> = {
    query: input.query,
    limit: input.limit,
  };
  if (input.namespace && input.namespace.trim().length > 0) {
    payload.namespace = input.namespace;
  }

  return [
    `const __matches = await tools.search(${JSON.stringify(payload)});`,
    "if (!Array.isArray(__matches) || __matches.length === 0) {",
    `  throw new Error(${JSON.stringify(`No tool matches query: ${input.query}`)});`,
    "}",
    "const __path = __matches[0]?.path;",
    'if (typeof __path !== "string" || __path.trim().length === 0) {',
    '  throw new Error("Top search result did not include a tool path");',
    "}",
    "let __target = tools;",
    "for (const __segment of __path.split('.')) {",
    "  if (!__segment) continue;",
    "  __target = __target?.[__segment];",
    "}",
    'if (typeof __target !== "function") {',
    "  throw new Error(`Tool not found: ${__path}`);",
    "}",
    `const __args = ${JSON.stringify(input.args, null, 2)};`,
    "const __result = await __target(__args);",
    "return { path: __path, result: __result };",
  ].join("\n");
};
