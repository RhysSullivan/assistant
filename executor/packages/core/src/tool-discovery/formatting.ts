import type { DiscoverIndexEntry } from "./types";

export function buildExampleCall(entry: DiscoverIndexEntry): string {
  const callPath = entry.preferredPath;
  if (entry.path.endsWith(".graphql")) {
    return `await tools.${callPath}({ query: "query { __typename }", variables: {} });`;
  }

  if (entry.displayInputHint === "{}") {
    return `await tools.${callPath}({});`;
  }

  const keys = entry.previewInputKeys;
  if (keys.length > 0) {
    const argsSnippet = keys
      .slice(0, 5)
      .map((key) => `${key}: ${key.toLowerCase().includes("input") ? "{ /* ... */ }" : "..."}`)
      .join(", ");

    return `await tools.${callPath}({ ${argsSnippet} });`;
  }

  return `await tools.${callPath}({ /* ... */ });`;
}

export function formatSignature(entry: DiscoverIndexEntry, depth: number): string {
  if (depth >= 2) {
    return `(input: ${entry.displayInputHint}): Promise<${entry.displayOutputHint}> [source=${entry.source}]`;
  }

  return `(input: ${entry.displayInputHint}): Promise<${entry.displayOutputHint}>`;
}

export function formatCanonicalSignature(entry: DiscoverIndexEntry): string {
  return `(input: ${entry.displayInputHint}): Promise<${entry.displayOutputHint}>`;
}
