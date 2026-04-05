import { Effect } from "effect";
import type { Executor, ToolMetadata, Source } from "@executor/sdk";

/**
 * Builds a tool description dynamically.
 *
 * Structure:
 *   1. Workflow (top — critical, least likely to be truncated)
 *   2. Available namespaces (bottom)
 */
export const buildExecuteDescription = (
  executor: Executor,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const sources: readonly Source[] = yield* executor.sources.list();
    const tools: readonly ToolMetadata[] = yield* executor.tools.list();

    const namespaces = new Set<string>();
    for (const tool of tools) namespaces.add(tool.sourceId);

    return formatDescription([...namespaces], sources);
  });

const formatDescription = (
  namespaces: readonly string[],
  sources: readonly Source[],
): string => {
  const lines: string[] = [
    "Execute TypeScript in a sandboxed runtime with access to configured API tools.",
    "",
    "## Workflow",
    "",
    '1. `const results = await tools.discover({ query: "<intent>", limit: 12 });`',
    "2. Pick a tool from results: `const path = results[0]?.path;`",
    "3. `const details = await tools.describe.tool({ path, includeSchemas: true });`",
    "4. Call the tool: `const result = await tools.<path>(input);`",
    "",
    "## Rules",
    "",
    "- The `tools` object is a lazy proxy — `Object.keys(tools)` won't work. Use `tools.discover()` to find tools.",
    "- Do not use `fetch` — all API calls go through `tools.*`.",
    "- If execution pauses for interaction, resume it with the returned `resumePayload`.",
  ];

  if (namespaces.length > 0) {
    lines.push("");
    lines.push("## Available namespaces");
    lines.push("");
    const sorted = [...namespaces].sort();
    for (const ns of sorted) {
      const source = sources.find((s) => s.id === ns);
      const label = source?.name ?? ns;
      lines.push(`- \`${ns}\`${label !== ns ? ` — ${label}` : ""}`);
    }
  }

  return lines.join("\n");
};
