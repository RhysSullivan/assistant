/**
 * Tool discovery — searchable index of tools for large APIs.
 *
 * When there are too many tools to fit in the LLM context window,
 * the agent uses `tools.discover({ query })` to search for relevant
 * tools by name, path, and description. Returns type signatures so
 * the LLM knows how to call what it finds.
 *
 * The discovered tools are already wired in the sandbox — the LLM
 * just doesn't get told about all of them in the system prompt.
 * `discover` fills that gap on demand.
 */

import { defineTool, isToolDefinition, type ToolDefinition, type ToolTree } from "./tools.js";
import { getArgsTypeString, getReturnsTypeString } from "./typechecker.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Index entry
// ---------------------------------------------------------------------------

export interface ToolIndexEntry {
  /** Full dotted path: "posthog.feature_flags.list" */
  readonly path: string;
  /** Tool description */
  readonly description: string;
  /** Approval mode */
  readonly approval: "auto" | "required";
  /** TypeScript signature: "(input: { ... }): Promise<{ ... }>" */
  readonly signature: string;
  /** Searchable text (lowercase): path + description */
  readonly searchText: string;
}

// ---------------------------------------------------------------------------
// Build index
// ---------------------------------------------------------------------------

export function buildToolIndex(tree: ToolTree): ToolIndexEntry[] {
  const entries: ToolIndexEntry[] = [];

  function walk(node: ToolTree, prefix: string) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isToolDefinition(value)) {
        const tool = value as ToolDefinition;
        const argsType = getArgsTypeString(tool);
        const returnsType = getReturnsTypeString(tool);
        entries.push({
          path,
          description: tool.description,
          approval: tool.approval,
          signature: `(input: ${argsType}): Promise<${returnsType}>`,
          searchText: `${path} ${tool.description}`.toLowerCase(),
        });
      } else {
        walk(value as ToolTree, path);
      }
    }
  }

  walk(tree, "");
  return entries;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Keyword search with fuzzy matching. Scores entries by how many
 * query terms match, with bonuses for path matches. An entry only
 * needs to match at least half the terms (rounded up) to be included,
 * so "github issues list update" finds tools matching any 2+ of those words.
 */
function searchIndex(
  index: ToolIndexEntry[],
  query: string,
  limit: number,
): ToolIndexEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return index.slice(0, limit);

  // Minimum terms that must match: at least 1, or half rounded up for 3+ terms
  const minMatches = terms.length <= 2 ? 1 : Math.ceil(terms.length / 2);

  const scored = index
    .map((entry) => {
      let score = 0;
      let matched = 0;

      for (const term of terms) {
        const inText = entry.searchText.includes(term);
        const inPath = entry.path.toLowerCase().includes(term);

        if (!inText && !inPath) continue;

        matched++;
        score += 1;
        // Bonus for path match (more specific)
        if (inPath) score += 2;
        // Bonus for exact word boundary match
        if (entry.searchText.includes(` ${term}`) || entry.searchText.startsWith(term)) score += 1;
      }

      if (matched < minMatches) return { entry, score: -1 };
      // Bonus for matching more terms
      score += matched * 2;
      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.entry);
}

// ---------------------------------------------------------------------------
// Create discover tool
// ---------------------------------------------------------------------------

export interface DiscoverToolOptions {
  /** Max results to return per query. Defaults to 20. */
  readonly maxResults?: number;
}

/**
 * Create a `discover` tool that searches the tool index.
 *
 * Usage in LLM-generated code:
 *   const results = await tools.discover({ query: "feature flags" });
 *   // results is an array of { path, description, approval, signature }
 *   // Then call: await tools.posthog.feature_flags.list({ ... })
 */
export function createDiscoverTool(
  tree: ToolTree,
  options?: DiscoverToolOptions,
) {
  const index = buildToolIndex(tree);
  const maxResults = options?.maxResults ?? 20;

  return defineTool({
    description: `Search for available tools by keyword. Returns matching tool paths, descriptions, and TypeScript signatures. Use this when you need to find tools for a specific task. There are ${index.length} tools available across all connected services.`,
    approval: "auto" as const,
    args: z.object({
      query: z.string().describe("Search keywords (e.g. 'feature flags', 'create user', 'analytics events')"),
    }),
    returns: z.object({
      results: z.array(z.object({
        path: z.string(),
        description: z.string(),
        approval: z.string(),
        signature: z.string(),
      })),
      total: z.number(),
    }),
    run: async (input) => {
      const results = searchIndex(index, input.query, maxResults);
      return {
        results: results.map((e) => ({
          path: e.path,
          description: e.description,
          approval: e.approval,
          signature: e.signature,
        })),
        total: results.length,
      };
    },
  });
}

/**
 * Count the total number of tool definitions in a tree.
 */
export function countTools(tree: ToolTree): number {
  let count = 0;
  for (const value of Object.values(tree)) {
    if (isToolDefinition(value)) {
      count++;
    } else {
      count += countTools(value as ToolTree);
    }
  }
  return count;
}
