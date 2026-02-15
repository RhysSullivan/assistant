import type {
  SourceAuthProfile,
  ToolDefinition,
  ToolDescriptor,
} from "../types";

const MAX_TOOLS_IN_ACTION_RESULT = 8_000;

export function truncateToolsForActionResult(
  tools: ToolDescriptor[],
  warnings: string[],
): { tools: ToolDescriptor[]; warnings: string[] } {
  if (tools.length <= MAX_TOOLS_IN_ACTION_RESULT) {
    return { tools, warnings };
  }

  return {
    tools: tools.slice(0, MAX_TOOLS_IN_ACTION_RESULT),
    warnings: [
      ...warnings,
      `Tool inventory truncated to ${MAX_TOOLS_IN_ACTION_RESULT} of ${tools.length} tools (Convex array limit). Use source filters or targeted lookups to narrow results.`,
    ],
  };
}

export function computeSourceAuthProfiles(tools: Map<string, ToolDefinition>): Record<string, SourceAuthProfile> {
  const profiles: Record<string, SourceAuthProfile> = {};

  for (const tool of tools.values()) {
    const credential = tool.credential;
    if (!credential) continue;

    const sourceKey = credential.sourceKey;
    const current = profiles[sourceKey];
    if (!current) {
      profiles[sourceKey] = {
        type: credential.authType,
        mode: credential.mode,
        ...(credential.authType === "apiKey" && credential.headerName
          ? { header: credential.headerName }
          : {}),
        inferred: true,
      };
      continue;
    }

    if (current.type !== credential.authType || current.mode !== credential.mode) {
      profiles[sourceKey] = {
        type: "mixed",
        inferred: true,
      };
    }
  }

  return profiles;
}

export function mergeTools(
  baseTools: Iterable<ToolDefinition>,
  externalTools: Iterable<ToolDefinition>,
): Map<string, ToolDefinition> {
  const merged = new Map<string, ToolDefinition>();

  for (const tool of baseTools) {
    merged.set(tool.path, tool);
  }

  for (const tool of externalTools) {
    merged.set(tool.path, tool);
  }

  return merged;
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

const GENERIC_NAMESPACE_SUFFIXES = new Set([
  "api",
  "apis",
  "openapi",
  "sdk",
  "service",
  "services",
]);

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

export function preferredToolPath(path: string): string {
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

export function getPathAliases(path: string): string[] {
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

export function normalizeHint(type?: string): string {
  return type && type.trim().length > 0 ? type : "unknown";
}
