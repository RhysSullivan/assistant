import type { ToolDefinition } from "./types";
import {
  compactArgKeysHint,
  compactArgTypeHint,
  compactDescriptionLine,
  compactReturnTypeHint,
  extractTopLevelTypeKeys,
} from "./type-hints";

interface DiscoverIndexEntry {
  path: string;
  preferredPath: string;
  aliases: string[];
  description: string;
  approval: ToolDefinition["approval"];
  source: string;
  argsType: string;
  returnsType: string;
  argPreviewKeys: string[];
  searchText: string;
  normalizedPath: string;
  normalizedSearchText: string;
}

const DISCOVER_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const GENERIC_NAMESPACE_SUFFIXES = new Set([
  "api",
  "apis",
  "openapi",
  "sdk",
  "service",
  "services",
]);

function normalizeType(type?: string): string {
  return type && type.trim().length > 0 ? type : "unknown";
}

function normalizeSearchToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenizePathSegment(value: string): string[] {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
  return normalized
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function simplifyNamespaceSegment(segment: string): string {
  const tokens = tokenizePathSegment(segment);
  if (tokens.length === 0) return segment;

  const collapsed: string[] = [];
  for (const token of tokens) {
    if (collapsed[collapsed.length - 1] === token) continue;
    collapsed.push(token);
  }

  while (collapsed.length > 1) {
    const last = collapsed[collapsed.length - 1];
    if (!last || !GENERIC_NAMESPACE_SUFFIXES.has(last)) break;
    collapsed.pop();
  }

  return collapsed.join("_");
}

function preferredToolPath(path: string): string {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return path;

  const simplifiedNamespace = simplifyNamespaceSegment(segments[0]!);
  if (!simplifiedNamespace || simplifiedNamespace === segments[0]) {
    return path;
  }

  return [simplifiedNamespace, ...segments.slice(1)].join(".");
}

function toCamelSegment(segment: string): string {
  return segment.replace(/_+([a-z0-9])/g, (_m, char: string) => char.toUpperCase());
}

function getPathAliases(path: string): string[] {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return [];

  const canonicalPath = path;
  const publicPath = preferredToolPath(path);

  const aliases = new Set<string>();
  const publicSegments = publicPath.split(".").filter(Boolean);
  const camelPath = publicSegments.map(toCamelSegment).join(".");
  const compactPath = publicSegments.map((segment) => segment.replace(/[_-]/g, "")).join(".");
  const lowerPath = publicPath.toLowerCase();

  if (publicPath !== canonicalPath) aliases.add(publicPath);
  if (camelPath !== publicPath) aliases.add(camelPath);
  if (compactPath !== publicPath) aliases.add(compactPath);
  if (lowerPath !== publicPath) aliases.add(lowerPath);

  return [...aliases].slice(0, 4);
}

function buildExampleCall(entry: DiscoverIndexEntry): string {
  const callPath = entry.preferredPath;
  if (entry.path.endsWith(".graphql")) {
    return `await tools.${callPath}({ query: "query { __typename }", variables: {} });`;
  }

  if (entry.argsType === "{}") {
    return `await tools.${callPath}({});`;
  }

  const keys = entry.argPreviewKeys.length > 0 ? entry.argPreviewKeys : extractTopLevelTypeKeys(entry.argsType);
  if (keys.length > 0) {
    const argsSnippet = keys.slice(0, 5)
      .map((key) => `${key}: ${key.toLowerCase().includes("input") ? "{ /* ... */ }" : "..."}`)
      .join(", ");
    return `await tools.${callPath}({ ${argsSnippet} });`;
  }

  return `await tools.${callPath}({ /* ... */ });`;
}

function buildIndex(tools: ToolDefinition[]): DiscoverIndexEntry[] {
  return tools
    .filter((tool) => tool.path !== "discover" && !tool.path.startsWith("catalog."))
    .map((tool) => {
      const preferredPath = preferredToolPath(tool.path);
      const aliases = getPathAliases(tool.path);
      const searchText = `${tool.path} ${preferredPath} ${aliases.join(" ")} ${tool.description} ${tool.source ?? ""}`.toLowerCase();

      return {
        path: tool.path,
        preferredPath,
        aliases,
        description: tool.description,
        approval: tool.approval,
        source: tool.source ?? "local",
        argsType: normalizeType(tool.metadata?.argsType),
        returnsType: normalizeType(tool.metadata?.returnsType),
        argPreviewKeys: Array.isArray(tool.metadata?.argPreviewKeys)
          ? tool.metadata.argPreviewKeys.filter((value): value is string => typeof value === "string")
          : [],
        searchText,
        normalizedPath: normalizeSearchToken(tool.path),
        normalizedSearchText: normalizeSearchToken(searchText),
      };
    });
}

function getTopLevelNamespace(path: string): string {
  return path.split(".")[0]?.toLowerCase() ?? "";
}

function extractNamespaceHints(terms: string[], namespaces: Set<string>): Set<string> {
  const hints = new Set<string>();

  for (const term of terms) {
    const direct = term.toLowerCase();
    if (namespaces.has(direct)) {
      hints.add(direct);
      continue;
    }

    const leadingSegment = direct.split(".")[0] ?? direct;
    if (namespaces.has(leadingSegment)) {
      hints.add(leadingSegment);
    }
  }

  return hints;
}

function deriveIntentPhrase(terms: string[], namespaceHints: Set<string>): string {
  const important = terms
    .map((term) => term.toLowerCase())
    .filter((term) => !namespaceHints.has(term))
    .filter((term) => !DISCOVER_STOP_WORDS.has(term))
    .filter((term) => term.length > 2);

  return normalizeSearchToken(important.join(" "));
}

function chooseBestPath(
  ranked: Array<{ entry: DiscoverIndexEntry; score: number }>,
  termCount: number,
): string | null {
  if (ranked.length === 0) return null;

  const best = ranked[0];
  if (!best) return null;

  const minScore = termCount === 0 ? 1 : Math.max(3, termCount * 2 - 1);
  if (best.score < minScore) {
    return null;
  }

  const second = ranked[1];
  if (second && best.score - second.score < 2) {
    return null;
  }

  return best.entry.preferredPath;
}

function scoreEntry(
  entry: DiscoverIndexEntry,
  terms: string[],
  namespaceHints: Set<string>,
  intentPhrase: string,
): number {
  let score = 0;
  let matched = 0;

  if (namespaceHints.size > 0) {
    const namespace = getTopLevelNamespace(entry.path);
    if (namespaceHints.has(namespace)) {
      score += 6;
    } else {
      score -= 8;
    }
  }

  for (const term of terms) {
    const normalizedTerm = normalizeSearchToken(term);
    const inPath = entry.path.toLowerCase().includes(term);
    const inNormalizedPath = normalizedTerm.length > 0 && entry.normalizedPath.includes(normalizedTerm);
    const inText = entry.searchText.includes(term);
    const inNormalizedText = normalizedTerm.length > 0 && entry.normalizedSearchText.includes(normalizedTerm);
    if (!inPath && !inText && !inNormalizedPath && !inNormalizedText) continue;
    matched += 1;
    score += 1;
    if (inPath || inNormalizedPath) score += 2;
  }

  if (intentPhrase.length >= 6) {
    if (entry.normalizedPath.includes(intentPhrase)) {
      score += 6;
    } else if (entry.normalizedSearchText.includes(intentPhrase)) {
      score += 3;
    }
  }

  if (terms.length > 0 && matched < Math.max(1, Math.ceil(terms.length / 2))) {
    return -1;
  }

  return score + matched * 2;
}

function formatSignature(entry: DiscoverIndexEntry, depth: number, compact: boolean): string {
  if (compact) {
    if (depth <= 0) {
      return "(input: ...): Promise<...>";
    }

    const args = entry.argPreviewKeys.length > 0
      ? compactArgKeysHint(entry.argPreviewKeys)
      : compactArgTypeHint(entry.argsType);
    const returns = compactReturnTypeHint(entry.returnsType);

    if (depth === 1) {
      return `(input: ${args}): Promise<${returns}>`;
    }
    return `(input: ${args}): Promise<${returns}> [source=${entry.source}]`;
  }

  if (depth <= 0) {
    return `(input: ${entry.argsType}): Promise<...>`;
  }
  if (depth === 1) {
    return `(input: ${entry.argsType}): Promise<${entry.returnsType}>`;
  }
  return `(input: ${entry.argsType}): Promise<${entry.returnsType}> [source=${entry.source}]`;
}

function listIndexForContext(index: DiscoverIndexEntry[], isToolAllowed: (toolPath: string) => boolean): DiscoverIndexEntry[] {
  return index.filter((entry) => isToolAllowed(entry.path));
}

export function createCatalogTools(tools: ToolDefinition[]): ToolDefinition[] {
  const index = buildIndex(tools);

  const namespacesTool: ToolDefinition = {
    path: "catalog.namespaces",
    source: "system",
    approval: "auto",
    description: "List available tool namespaces with counts and sample callable paths.",
    metadata: {
      argsType: "{}",
      returnsType: "{ namespaces: Array<{ namespace: string; toolCount: number; samplePaths: string[] }>; total: number }",
      displayArgsType: "{}",
      displayReturnsType: "{ namespaces: ...; total: number }",
    },
    run: async (_input: unknown, context) => {
      const visible = listIndexForContext(index, context.isToolAllowed);
      const grouped = new Map<string, string[]>();

      for (const entry of visible) {
        const namespace = entry.preferredPath.split(".")[0] ?? entry.path.split(".")[0] ?? "default";
        const list = grouped.get(namespace) ?? [];
        list.push(entry.preferredPath);
        grouped.set(namespace, list);
      }

      const namespaces = [...grouped.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([namespace, paths]) => ({
          namespace,
          toolCount: paths.length,
          samplePaths: [...paths].sort((a, b) => a.localeCompare(b)).slice(0, 3),
        }));

      return {
        namespaces,
        total: namespaces.length,
      };
    },
  };

  const toolsTool: ToolDefinition = {
    path: "catalog.tools",
    source: "system",
    approval: "auto",
    description: "List tools with typed signatures. Supports namespace and query filters in one call.",
    metadata: {
      argsType: "{ namespace?: string; query?: string; depth?: number; limit?: number; compact?: boolean }",
      returnsType:
        "{ results: Array<{ path: string; aliases: string[]; source: string; approval: 'auto' | 'required'; description: string; argsType: string; returnsType: string; signature: string; exampleCall: string }>; total: number }",
      displayArgsType: "{ namespace?: string; query?: string; depth?: number; limit?: number; compact?: boolean }",
      displayReturnsType: "{ results: ...; total: number }",
    },
    run: async (input: unknown, context) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const namespaceFilter = String(payload.namespace ?? "").trim().toLowerCase();
      const query = String(payload.query ?? "").trim().toLowerCase();
      const depth = Math.max(0, Math.min(2, Number(payload.depth ?? 1)));
      const limit = Math.max(1, Math.min(200, Number(payload.limit ?? 50)));
      const compact = payload.compact === false ? false : true;
      const terms = query.length > 0 ? query.split(/\s+/).filter(Boolean) : [];

      const visible = listIndexForContext(index, context.isToolAllowed);
      const namespaceScoped = namespaceFilter.length > 0
        ? visible.filter((entry) => {
          const namespace = entry.preferredPath.split(".")[0]?.toLowerCase() ?? "";
          const canonicalNamespace = entry.path.split(".")[0]?.toLowerCase() ?? "";
          return namespace === namespaceFilter || canonicalNamespace === namespaceFilter;
        })
        : visible;

      const ranked = (terms.length > 0
        ? namespaceScoped
          .map((entry) => ({ entry, score: scoreEntry(entry, terms, new Set<string>(), "") }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.entry)
        : [...namespaceScoped].sort((a, b) => a.preferredPath.localeCompare(b.preferredPath)))
        .slice(0, limit);

      const results = ranked.map((entry) => ({
        path: entry.preferredPath,
        aliases: entry.aliases,
        source: entry.source,
        approval: entry.approval,
        description: compact ? compactDescriptionLine(entry.description) : entry.description,
        argsType: compact
          ? (entry.argPreviewKeys.length > 0 ? compactArgKeysHint(entry.argPreviewKeys) : compactArgTypeHint(entry.argsType))
          : entry.argsType,
        returnsType: compact ? compactReturnTypeHint(entry.returnsType) : entry.returnsType,
        signature: formatSignature(entry, depth, compact),
        exampleCall: buildExampleCall(entry),
      }));

      return {
        results,
        total: results.length,
      };
    },
  };

  return [namespacesTool, toolsTool];
}

export function createDiscoverTool(tools: ToolDefinition[]): ToolDefinition {
  const index = buildIndex(tools);

  return {
    path: "discover",
    source: "system",
    approval: "auto",
    description:
      "Search available tools by keyword. Returns preferred path aliases, signature hints, and ready-to-copy call examples. Compact mode is enabled by default.",
    metadata: {
      argsType: "{ query: string; depth?: number; limit?: number; compact?: boolean }",
      returnsType:
        "{ bestPath: string | null; results: Array<{ path: string; aliases: string[]; source: string; approval: 'auto' | 'required'; description: string; signature: string; exampleCall: string }>; total: number }",
    },
    run: async (input: unknown, context) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const query = String(payload.query ?? "").trim().toLowerCase();
      const depth = Math.max(0, Math.min(2, Number(payload.depth ?? 1)));
      const limit = Math.max(1, Math.min(50, Number(payload.limit ?? 8)));
      const compact = payload.compact === false ? false : true;
      const terms = query.length > 0 ? query.split(/\s+/).filter(Boolean) : [];
      const namespaces = new Set(index.map((entry) => getTopLevelNamespace(entry.path)).filter(Boolean));
      const namespaceHints = extractNamespaceHints(terms, namespaces);
      const intentPhrase = deriveIntentPhrase(terms, namespaceHints);

      const visibleEntries = index.filter((entry) => context.isToolAllowed(entry.path));
      const namespaceScopedEntries = namespaceHints.size > 0
        ? visibleEntries.filter((entry) => namespaceHints.has(getTopLevelNamespace(entry.path)))
        : visibleEntries;
      const candidateEntries = namespaceScopedEntries.length > 0 ? namespaceScopedEntries : visibleEntries;

      const ranked = candidateEntries
        .map((entry) => ({ entry, score: scoreEntry(entry, terms, namespaceHints, intentPhrase) }))
        .filter((item) => item.score > 0 || terms.length === 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const results = ranked
        .map(({ entry }) => ({
          path: entry.preferredPath,
          aliases: entry.aliases,
          source: entry.source,
          approval: entry.approval,
          description: compact ? compactDescriptionLine(entry.description) : entry.description,
          signature: formatSignature(entry, depth, compact),
          exampleCall: buildExampleCall(entry),
        }));

      return {
        bestPath: chooseBestPath(ranked, terms.length),
        results,
        total: results.length,
      };
    },
  };
}
