import { toPreferredToolPath } from "./tool-paths";

export function unknownToolErrorMessage(toolPath: string, suggestions: string[]): string {
  const suggestionText = suggestions.length > 0
    ? `\nDid you mean: ${suggestions.map((path) => `tools.${path}`).join(", ")}`
    : "";
  const queryHint = toolPath.split(".").filter(Boolean).join(" ");
  const discoverHint = `\nTry: const found = await tools.discover({ query: "${queryHint}", compact: true, depth: 1, limit: 12 });`;
  return `Unknown tool: ${toolPath}${suggestionText}${discoverHint}`;
}

export function pickBestToolHitByPath<T extends { path: string }>(
  hits: readonly T[],
  requestedPath: string,
): T | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;

  // Prefer exact match on preferred path formatting, otherwise shortest canonical path.
  const exact = hits.find((hit) => toPreferredToolPath(hit.path) === toPreferredToolPath(requestedPath));
  if (exact) return exact;

  return [...hits].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0] ?? null;
}
